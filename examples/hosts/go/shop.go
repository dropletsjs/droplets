// The shop demo (examples/shop) on this host, beside the basic page:
//
//   - a same-origin proxy for what the browser asks the shop for (/index.js,
//     /env.js, /index.css, /droplets/*, /assets/*, /api/*), so its cookies
//     are first-party and nothing is cross-origin;
//   - four pages (/gallery, /product/{slug}, /login, /admin) that fetch the
//     shop's fragments on the server, all at once, and compose them in one
//     layout.
//
// The contract they follow is examples/shop/CONTRACT.md.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

// The stack this host is, in the footer: the one thing that differs between hosts.
const stack = "Go"

// What the browser's request may tell the shop; nothing that names a host, nothing per hop. Cookie goes on filtered.
var forwardedRequestHeaders = []string{
	"Accept",
	"Accept-Language",
	"Content-Type",
	"If-None-Match",
	"Origin",
	"Referer",
	"User-Agent",
	"X-Droplet-Props",
	"X-Droplets-Build",
}

// Per hop (RFC 9110 §7.6.1), or no longer true once the client has decoded the body.
var droppedResponseHeaders = []string{
	"Connection",
	"Keep-Alive",
	"Proxy-Authenticate",
	"Proxy-Authorization",
	"Proxy-Connection",
	"Te",
	"Trailer",
	"Transfer-Encoding",
	"Upgrade",
	"Content-Encoding",
	"Content-Length",
}

// The shop's own cookies, the only ones it is sent: another app's on this origin stay here.
var shopCookies = []string{"cart_id", "shop_admin"}

var proxyMethods = []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}

// The largest request body the proxy passes on: the shop's image upload (2 MB) with room for the form around it.
const maxBodyBytes = 4 << 20

type shopConfig struct {
	// How this process reaches the shop (http://shop:8300 in Docker).
	internalURL string
	// This host's own public URL; its origin goes out as x-droplet-location.
	publicURL string
	client    *http.Client
	files     fs.FS
}

type shop struct {
	internal string
	// Written out in the environment: never the client's Host.
	origin string
	client *http.Client
	files  fs.FS
	pages  map[string]*template.Template
}

func newShop(config shopConfig) (*shop, error) {
	public, err := url.Parse(config.publicURL)
	if err != nil || public.Scheme == "" || public.Host == "" {
		return nil, fmt.Errorf("SHOP_PUBLIC_URL %q is not an absolute URL", config.publicURL)
	}
	pages := map[string]*template.Template{}
	for _, name := range []string{"gallery", "product", "login", "admin", "not-found"} {
		page, err := template.ParseFS(config.files, "templates/shop/layout.html", "templates/shop/"+name+".html")
		if err != nil {
			return nil, err
		}
		pages[name] = page
	}
	return &shop{
		internal: strings.TrimRight(config.internalURL, "/"),
		origin:   public.Scheme + "://" + public.Host,
		client:   config.client,
		files:    config.files,
		pages:    pages,
	}, nil
}

// handler answers the proxied paths before the pages' mux, which would
// redirect a path with a dot segment instead of refusing it.
func (s *shop) handler(pages http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isProxied(r.URL.Path) {
			s.proxy(w, r)
			return
		}
		pages.ServeHTTP(w, r)
	})
}

func (s *shop) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /shop.css", s.stylesheet)
	mux.HandleFunc("GET /gallery", s.gallery)
	mux.HandleFunc("GET /product/{slug}", s.product)
	mux.HandleFunc("GET /login", s.login)
	mux.HandleFunc("GET /admin", s.admin)
}

func isProxied(path string) bool {
	switch path {
	case "/index.js", "/env.js", "/index.css":
		return true
	}
	return strings.HasPrefix(path, "/droplets/") || strings.HasPrefix(path, "/assets/") || strings.HasPrefix(path, "/api/")
}

// hasDotSegment reads the decoded path, so %2e%2e and ..%2f count too: never a shop route.
func hasDotSegment(path string) bool {
	return slices.ContainsFunc(strings.Split(path, "/"), func(segment string) bool {
		return segment == "." || segment == ".."
	})
}

// shopCookie is the browser's Cookie header with the shop's cookies only, or "".
func shopCookie(r *http.Request) string {
	var kept []string
	for _, header := range r.Header.Values("Cookie") {
		for pair := range strings.SplitSeq(header, ";") {
			pair = strings.TrimSpace(pair)
			name, _, _ := strings.Cut(pair, "=")
			if slices.Contains(shopCookies, strings.TrimSpace(name)) {
				kept = append(kept, pair)
			}
		}
	}
	return strings.Join(kept, "; ")
}

// ---- The proxy ----------------------------------------------------------------

// proxy passes the browser's request on to the shop and its answer back:
// status, headers less the per-hop ones, every Set-Cookie, a redirect as it is.
func (s *shop) proxy(w http.ResponseWriter, r *http.Request) {
	if hasDotSegment(r.URL.Path) {
		http.Error(w, "Bad request.", http.StatusBadRequest)
		return
	}
	if !slices.Contains(proxyMethods, r.Method) {
		w.Header().Set("Allow", strings.Join(proxyMethods, ", "))
		http.Error(w, "Method not allowed.", http.StatusMethodNotAllowed)
		return
	}
	var body io.ReadCloser
	if r.Method != http.MethodGet && r.Method != http.MethodHead && r.ContentLength != 0 {
		if r.ContentLength > maxBodyBytes {
			http.Error(w, "Request body too large.", http.StatusRequestEntityTooLarge)
			return
		}
		body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	}
	// Concatenated, not resolved: a path like //elsewhere stays a path on the shop.
	upstream, err := http.NewRequestWithContext(r.Context(), r.Method, s.internal+r.URL.RequestURI(), body)
	if err != nil {
		http.Error(w, "Bad request.", http.StatusBadRequest)
		return
	}
	if body != nil {
		// -1 (chunked) stays unknown; a known length goes on as it is.
		upstream.ContentLength = r.ContentLength
	}
	upstream.Header.Set("x-droplet-location", s.origin)
	for _, name := range forwardedRequestHeaders {
		for _, value := range r.Header.Values(name) {
			upstream.Header.Add(name, value)
		}
	}
	if cookie := shopCookie(r); cookie != "" {
		upstream.Header.Set("Cookie", cookie)
	}

	resp, err := s.client.Do(upstream)
	if err != nil {
		if body != nil && overLimit(body) {
			http.Error(w, "Request body too large.", http.StatusRequestEntityTooLarge)
			return
		}
		log.Printf("[shop proxy] %s %s: %v", r.Method, r.URL.Path, err)
		http.Error(w, "The shop is unreachable.", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// And whatever the shop's Connection header names as per hop.
	dropped := slices.Clone(droppedResponseHeaders)
	for _, value := range resp.Header.Values("Connection") {
		for name := range strings.SplitSeq(value, ",") {
			dropped = append(dropped, http.CanonicalHeaderKey(strings.TrimSpace(name)))
		}
	}
	// Set-Cookie untouched: the shop never sets Domain, so they belong to this origin.
	for name, values := range resp.Header {
		if !slices.Contains(dropped, name) {
			w.Header()[name] = slices.Clone(values)
		}
	}
	w.WriteHeader(resp.StatusCode)
	if r.Method != http.MethodHead {
		io.Copy(w, resp.Body)
	}
}

// overLimit says whether the body went over maxBodyBytes. The client wraps
// a body's read error on the way out, but the reader keeps it: a read of
// nothing returns it again.
func overLimit(body io.Reader) bool {
	_, err := body.Read(nil)
	var tooLarge *http.MaxBytesError
	return errors.As(err, &tooLarge)
}

// ---- Fragments ------------------------------------------------------------------

type pair struct{ key, value string }

type want struct {
	id     string
	params []pair
}

type fragment struct {
	html     template.HTML
	status   int
	location string
	cookies  []string
	link     string
}

func encode(params []pair) string {
	parts := make([]string, len(params))
	for i, p := range params {
		parts[i] = url.QueryEscape(p.key) + "=" + url.QueryEscape(p.value)
	}
	return strings.Join(parts, "&")
}

// fetch is GET /droplets/<id>?<params>: the fragment, or a note saying it
// is unavailable.
func (s *shop) fetch(r *http.Request, id string, params []pair) fragment {
	result := fragment{status: http.StatusBadGateway}
	inserted, err := s.fetchInto(&result, r, id, params)
	if err != nil {
		log.Printf("[shop] %s: %v", id, err)
		result.status = http.StatusBadGateway
	}
	if inserted {
		return result
	}
	reason := "unreachable"
	if result.status != http.StatusBadGateway {
		reason = fmt.Sprintf("HTTP %d", result.status)
	}
	result.html = template.HTML(fmt.Sprintf(`<p class="shop-unavailable">The %s droplet is unavailable (%s).</p>`,
		template.HTMLEscapeString(id), reason))
	return result
}

// fetchInto asks as the browser's request: its shop cookies, this page as
// the host. Only an HTML answer is a fragment (a 500 carries the droplet's
// error page); anything else may echo the props, so it is never inserted.
func (s *shop) fetchInto(result *fragment, r *http.Request, id string, params []pair) (bool, error) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.internal+"/droplets/"+url.PathEscape(id)+"?"+encode(params), nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("accept", "text/html")
	req.Header.Set("x-droplet-location", s.origin)
	req.Header.Set("referer", s.origin+r.URL.RequestURI())
	if cookie := shopCookie(r); cookie != "" {
		req.Header.Set("cookie", cookie)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	result.status = resp.StatusCode
	result.cookies = resp.Header.Values("Set-Cookie")
	result.link = strings.Join(resp.Header.Values("Link"), ", ")
	if resp.StatusCode/100 == 3 {
		result.location = resp.Header.Get("Location")
		return false, nil
	}
	if !isFragment(resp) {
		return false, nil
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, err
	}
	// Trusted markup from the shop: inserted as it is.
	result.html = template.HTML(body)
	return true, nil
}

func (s *shop) fetchAll(r *http.Request, wants []want) []fragment {
	results := make([]fragment, len(wants))
	var wg sync.WaitGroup
	for i, w := range wants {
		wg.Go(func() { results[i] = s.fetch(r, w.id, w.params) })
	}
	wg.Wait()
	return results
}

type category struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type product struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Slug     string   `json:"slug"`
	Category category `json:"category"`
}

// lookup reads a product's name, category and id from the product page's
// public _data read; nil when there is none, or it is out of shape.
func (s *shop) lookup(ctx context.Context, slug string) *product {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		s.internal+"/droplets/product-page/_data?"+encode([]pair{{"slug", slug}}), nil)
	if err != nil {
		return nil
	}
	req.Header.Set("x-droplet-location", s.origin)
	req.Header.Set("accept", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		log.Printf("[shop] product %s: %v", slug, err)
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	var answer struct {
		Data struct {
			Product *product `json:"product"`
		} `json:"data"`
	}
	// A field of another type fails the decode: the product counts as not found.
	if json.NewDecoder(resp.Body).Decode(&answer) != nil {
		return nil
	}
	found := answer.Data.Product
	if found == nil || found.ID == "" || found.Name == "" {
		return nil
	}
	if found.Slug == "" {
		found.Slug = slug
	}
	return found
}

type linkTag struct{ Rel, Href, As string }

var linkPart = regexp.MustCompile(`^\s*<([^>]*)>(.*)$`)

// linkTags is the fragments' Link preloads, for the page's head: on this origin only.
func (s *shop) linkTags(results []fragment) []linkTag {
	var tags []linkTag
	for _, result := range results {
		// A comma inside a parameter's value does not start a new link.
		var parts []string
		for piece := range strings.SplitSeq(result.link, ",") {
			if strings.HasPrefix(strings.TrimSpace(piece), "<") || len(parts) == 0 {
				parts = append(parts, piece)
			} else {
				parts[len(parts)-1] += "," + piece
			}
		}
		for _, part := range parts {
			match := linkPart.FindStringSubmatch(part)
			if match == nil {
				continue
			}
			params := map[string]string{}
			for param := range strings.SplitSeq(match[2], ";") {
				key, value, _ := strings.Cut(param, "=")
				key, value = strings.ToLower(strings.TrimSpace(key)), strings.Trim(strings.TrimSpace(value), `"`)
				if key != "" && value != "" {
					params[key] = value
				}
			}
			rel := params["rel"]
			if rel != "preload" && rel != "modulepreload" {
				continue
			}
			href, err := url.Parse(match[1])
			if err != nil || href.Scheme+"://"+href.Host != s.origin {
				continue
			}
			tag := linkTag{Rel: rel, Href: match[1], As: params["as"]}
			if !slices.Contains(tags, tag) {
				tags = append(tags, tag)
			}
		}
	}
	return tags
}

// query is the page's query as pairs, in order, repeated keys kept.
func query(r *http.Request) []pair {
	var pairs []pair
	for piece := range strings.SplitSeq(r.URL.RawQuery, "&") {
		if piece == "" {
			continue
		}
		rawKey, rawValue, _ := strings.Cut(piece, "=")
		key, keyErr := url.QueryUnescape(rawKey)
		value, valueErr := url.QueryUnescape(rawValue)
		if keyErr == nil && valueErr == nil {
			pairs = append(pairs, pair{key, value})
		}
	}
	return pairs
}

// pick is the page's query parameters named in keys, in that order.
func pick(r *http.Request, keys ...string) []pair {
	all := query(r)
	var picked []pair
	for _, key := range keys {
		for _, p := range all {
			if p.key == key {
				picked = append(picked, p)
			}
		}
	}
	return picked
}

type pageData struct {
	Stack     string
	Title     string
	Current   string
	Links     []linkTag
	Toasts    template.HTML
	Cart      template.HTML
	Fragments []template.HTML
	Product   *product
}

// render fetches the toasts (first in the body), the header's cart and the
// page's fragments, then answers: a droplet's redirect as it is, otherwise
// the page, with every Set-Cookie the fragments sent.
func (s *shop) render(w http.ResponseWriter, r *http.Request, page string, data pageData, status int, wants ...want) {
	all := append([]want{{id: "toast-center"}, {id: "shopping-cart", params: []pair{{"variant", "badge"}}}}, wants...)
	results := s.fetchAll(r, all)
	header := w.Header()
	header.Set("Cache-Control", "private, no-store")
	for _, result := range results {
		for _, cookie := range result.cookies {
			header.Add("Set-Cookie", cookie)
		}
	}
	for _, result := range results {
		if result.location != "" {
			header.Set("Location", result.location)
			w.WriteHeader(result.status)
			return
		}
	}
	data.Stack = stack
	data.Links = s.linkTags(results)
	data.Toasts, data.Cart = results[0].html, results[1].html
	for _, result := range results[2:] {
		data.Fragments = append(data.Fragments, result.html)
	}
	render(w, s.pages[page], "layout", status, data)
}

// ---- Pages ----------------------------------------------------------------------

func (s *shop) stylesheet(w http.ResponseWriter, r *http.Request) {
	http.ServeFileFS(w, r, s.files, "static/shop.css")
}

func (s *shop) gallery(w http.ResponseWriter, r *http.Request) {
	// The whole query to both: the shop drops what a droplet does not take.
	all := query(r)
	s.render(w, r, "gallery", pageData{Title: "Gallery", Current: "/gallery"}, http.StatusOK,
		want{"product-filter", all}, want{"product-library", all})
}

func (s *shop) product(w http.ResponseWriter, r *http.Request) {
	found := s.lookup(r.Context(), r.PathValue("slug"))
	if found == nil {
		s.render(w, r, "not-found", pageData{Title: "Not found"}, http.StatusNotFound)
		return
	}
	comments := append(pick(r, "order", "page", "showing"), pair{"productId", found.ID})
	// v, when the link had one: the shop serves its build's page for the
	// current version and redirects an old one to this URL without it.
	props := append([]pair{{"slug", found.Slug}}, pick(r, "v")...)
	s.render(w, r, "product", pageData{Title: found.Name, Product: found}, http.StatusOK,
		want{"product-page", props}, want{"product-comments", comments})
}

func (s *shop) login(w http.ResponseWriter, r *http.Request) {
	s.render(w, r, "login", pageData{Title: "Log in"}, http.StatusOK, want{"login", pick(r, "next")})
}

func (s *shop) admin(w http.ResponseWriter, r *http.Request) {
	s.render(w, r, "admin", pageData{Title: "Admin", Current: "/admin"}, http.StatusOK,
		want{"product-admin", pick(r, "view", "id")})
}

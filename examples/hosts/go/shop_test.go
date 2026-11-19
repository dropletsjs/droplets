package main

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

const testOrigin = "http://shop.example:8017"

// browser answers redirects as they are, as a test needs to see them.
var browser = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

// newHost starts this host in front of a stand-in for the shop.
func newHost(t *testing.T, upstream http.HandlerFunc) *httptest.Server {
	t.Helper()
	shopServer := httptest.NewServer(upstream)
	t.Cleanup(shopServer.Close)
	s, err := newShop(shopConfig{internalURL: shopServer.URL + "/", publicURL: testOrigin + "/ignored", client: newClient(), files: files})
	if err != nil {
		t.Fatal(err)
	}
	pages := http.NewServeMux()
	s.routes(pages)
	host := httptest.NewServer(s.handler(pages))
	t.Cleanup(host.Close)
	return host
}

func neverAsked(t *testing.T) http.HandlerFunc {
	return func(_ http.ResponseWriter, r *http.Request) {
		t.Errorf("the shop was asked for %s %s", r.Method, r.URL)
	}
}

func do(t *testing.T, req *http.Request) (*http.Response, string) {
	t.Helper()
	resp, err := browser.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp, string(body)
}

func get(t *testing.T, target string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, target, nil)
	return do(t, req)
}

func TestProxyRefusesDotSegments(t *testing.T) {
	host := newHost(t, neverAsked(t))
	for _, path := range []string{"/assets/%2e%2e/secret", "/api/./cart", "/droplets/..%2fsecret", "/assets/public/%2E"} {
		resp, _ := get(t, host.URL+path)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", path, resp.StatusCode)
		}
	}
}

func TestProxyRefusesMethodsOffItsList(t *testing.T) {
	host := newHost(t, neverAsked(t))
	req, _ := http.NewRequest("TRACE", host.URL+"/api/cart", nil)
	resp, _ := do(t, req)
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("TRACE: %d, want 405", resp.StatusCode)
	}
}

func TestProxyRefusesABodyOverTheLimit(t *testing.T) {
	t.Run("with a length", func(t *testing.T) {
		host := newHost(t, neverAsked(t))
		req, _ := http.NewRequest(http.MethodPost, host.URL+"/droplets/login", bytes.NewReader(make([]byte, maxBodyBytes+1)))
		if resp, _ := do(t, req); resp.StatusCode != http.StatusRequestEntityTooLarge {
			t.Errorf("%d, want 413", resp.StatusCode)
		}
	})
	t.Run("chunked", func(t *testing.T) {
		host := newHost(t, func(w http.ResponseWriter, r *http.Request) {
			io.Copy(io.Discard, r.Body)
		})
		// A reader of no known length goes out chunked.
		body := struct{ io.Reader }{bytes.NewReader(make([]byte, maxBodyBytes+1))}
		req, _ := http.NewRequest(http.MethodPost, host.URL+"/droplets/login", body)
		if resp, _ := do(t, req); resp.StatusCode != http.StatusRequestEntityTooLarge {
			t.Errorf("%d, want 413", resp.StatusCode)
		}
	})
}

func TestProxyForwardsOnlyItsListedHeaders(t *testing.T) {
	var seen *http.Request
	host := newHost(t, func(w http.ResponseWriter, r *http.Request) {
		seen = r.Clone(r.Context())
		w.Header().Add("Set-Cookie", "cart_id=1; Path=/; HttpOnly")
		w.Header().Add("Set-Cookie", "shop_admin=2; Path=/; HttpOnly")
		w.Header().Set("Location", "/admin")
		w.WriteHeader(http.StatusSeeOther)
	})
	req, _ := http.NewRequest(http.MethodPost, host.URL+"/droplets/login//x?a=%20b", strings.NewReader("user=admin"))
	req.Host = "evil.example"
	req.Header.Set("Origin", testOrigin)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Cookie", "other=1; cart_id=a; shop_admin=b")
	for _, name := range []string{"X-Forwarded-Host", "Forwarded", "X-Droplet-Location", "Authorization"} {
		req.Header.Set(name, "evil.example")
	}
	resp, _ := do(t, req)

	if resp.StatusCode != http.StatusSeeOther || resp.Header.Get("Location") != "/admin" {
		t.Errorf("redirect: %d %q", resp.StatusCode, resp.Header.Get("Location"))
	}
	if cookies := resp.Header.Values("Set-Cookie"); len(cookies) != 2 {
		t.Errorf("Set-Cookie: %q", cookies)
	}
	if seen == nil {
		t.Fatal("the shop was not asked")
	}
	if seen.Host == "evil.example" || seen.Host == "" {
		t.Errorf("Host: %q", seen.Host)
	}
	if seen.RequestURI != "/droplets/login//x?a=%20b" {
		t.Errorf("target: %q", seen.RequestURI)
	}
	want := map[string]string{
		"X-Droplet-Location": testOrigin,
		"Cookie":             "cart_id=a; shop_admin=b",
		"Origin":             testOrigin,
		"Content-Type":       "application/x-www-form-urlencoded",
		"X-Forwarded-Host":   "",
		"Forwarded":          "",
		"Authorization":      "",
	}
	for name, value := range want {
		if got := seen.Header.Get(name); got != value {
			t.Errorf("%s: %q, want %q", name, got, value)
		}
	}
}

func TestProxyAnswers502WithoutTheShop(t *testing.T) {
	gone := httptest.NewServer(http.NotFoundHandler())
	gone.Close()
	s, err := newShop(shopConfig{internalURL: gone.URL, publicURL: testOrigin, client: newClient(), files: files})
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(s.handler(http.NewServeMux()))
	defer host.Close()
	resp, body := get(t, host.URL+"/index.js")
	if resp.StatusCode != http.StatusBadGateway || !strings.Contains(body, "The shop is unreachable.") {
		t.Errorf("%d %q", resp.StatusCode, body)
	}
}

func TestOneVisitorsCookiesNeverReachTheNext(t *testing.T) {
	var mu sync.Mutex
	var cookies []string
	host := newHost(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		cookies = append(cookies, r.Header.Get("Cookie"))
		mu.Unlock()
		http.SetCookie(w, &http.Cookie{Name: "cart_id", Value: "first", Path: "/"})
		w.Write([]byte(`{}`))
	})
	get(t, host.URL+"/api/cart")
	get(t, host.URL+"/api/cart")
	if len(cookies) != 2 || cookies[1] != "" {
		t.Errorf("the second visitor sent %q", cookies)
	}
}

// fragments stands in for the shop's fragments: each id answers its own way.
func fragments(answers map[string]func(http.ResponseWriter, *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/droplets/")
		if answer, ok := answers[id]; ok {
			answer(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(`<djs-shop data-droplet="` + id + `"></djs-shop>`))
	}
}

func TestPageSendsThisOriginAndTheBrowsersShopCookies(t *testing.T) {
	var mu sync.Mutex
	seen := map[string]http.Header{}
	host := newHost(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen[r.URL.Path] = r.Header.Clone()
		mu.Unlock()
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("<djs-shop></djs-shop>"))
	})
	req, _ := http.NewRequest(http.MethodGet, host.URL+"/gallery?q=glass&sort=new", nil)
	req.Host = "evil.example"
	req.Header.Set("Cookie", "other=1; cart_id=a")
	if resp, _ := do(t, req); resp.StatusCode != http.StatusOK || resp.Header.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("%d, %q", resp.StatusCode, resp.Header.Get("Cache-Control"))
	}
	for _, id := range []string{"toast-center", "shopping-cart", "product-filter", "product-library"} {
		header := seen["/droplets/"+id]
		if header == nil {
			t.Errorf("%s: not asked", id)
			continue
		}
		if header.Get("X-Droplet-Location") != testOrigin || header.Get("Referer") != testOrigin+"/gallery?q=glass&sort=new" ||
			header.Get("Cookie") != "cart_id=a" {
			t.Errorf("%s: %v", id, header)
		}
	}
}

func TestPageInsertsOnlyAnHTMLAnswer(t *testing.T) {
	host := newHost(t, fragments(map[string]func(http.ResponseWriter, *http.Request){
		"product-library": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"q":"<script>alert(1)</script>"}`))
		},
	}))
	resp, body := get(t, host.URL+"/gallery?q=%3Cscript%3E")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("%d", resp.StatusCode)
	}
	if strings.Contains(body, "<script>alert") || !strings.Contains(body, "The product-library droplet is unavailable (HTTP 400).") {
		t.Errorf("page: %s", body)
	}
	if !strings.Contains(body, `<djs-shop data-droplet="product-filter">`) {
		t.Errorf("the filter's fragment is missing: %s", body)
	}
}

func TestPageAnswersAFragmentsRedirect(t *testing.T) {
	host := newHost(t, fragments(map[string]func(http.ResponseWriter, *http.Request){
		"product-page/_data": func(w http.ResponseWriter, _ *http.Request) {
			w.Write([]byte(`{"data":{"product":{"id":"p1","name":"Glass","slug":"glass"}}}`))
		},
		"product-page": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Set-Cookie", "cart_id=1")
			w.Header().Set("Location", testOrigin+"/product/glass")
			w.WriteHeader(http.StatusFound)
		},
	}))
	resp, _ := get(t, host.URL+"/product/glass?v=0000000000")
	if resp.StatusCode != http.StatusFound || resp.Header.Get("Location") != testOrigin+"/product/glass" ||
		resp.Header.Get("Set-Cookie") != "cart_id=1" {
		t.Errorf("%d %v", resp.StatusCode, resp.Header)
	}
}

func TestProductOutOfShapeIsNotFound(t *testing.T) {
	host := newHost(t, fragments(map[string]func(http.ResponseWriter, *http.Request){
		"product-page/_data": func(w http.ResponseWriter, _ *http.Request) {
			w.Write([]byte(`{"data":{"product":{"id":7,"name":"Glass"}}}`))
		},
	}))
	resp, body := get(t, host.URL+"/product/glass")
	if resp.StatusCode != http.StatusNotFound || !strings.Contains(body, "This product does not exist.") {
		t.Errorf("%d %s", resp.StatusCode, body)
	}
}

func TestLinkTagsKeepThisOriginsPreloads(t *testing.T) {
	s := &shop{origin: testOrigin}
	tags := s.linkTags([]fragment{
		{link: `<` + testOrigin + `/assets/a.js>; rel="modulepreload", <https://elsewhere.example/b.js>; rel=modulepreload`},
		{link: `<` + testOrigin + `/assets/a.js>; rel=modulepreload, <` + testOrigin + `/assets/c.css>; rel=preload; as=style; title="a, b"`},
		{link: `<` + testOrigin + `/next>; rel=next`},
	})
	want := []linkTag{
		{Rel: "modulepreload", Href: testOrigin + "/assets/a.js"},
		{Rel: "preload", Href: testOrigin + "/assets/c.css", As: "style"},
	}
	if len(tags) != len(want) || tags[0] != want[0] || tags[1] != want[1] {
		t.Errorf("%+v", tags)
	}
}

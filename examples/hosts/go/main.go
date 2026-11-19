// Droplets embedded from Go, standard library only.
//
// A handler fetches each droplet as an HTML fragment from the droplets
// server, with x-droplet-location set to the origin browsers will use, and
// pastes the fragments into an html/template. The page loads /index.js once;
// the elements then hydrate themselves. shop.go runs the shop demo beside it.
package main

import (
	"context"
	"embed"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

//go:embed templates static
var files embed.FS

// The Svelte example's droplets (examples/frameworks/svelte), one per mode.
var basicIDs = []string{"client", "ssr-hydrate", "ssr-nohydrate"}

func getenv(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

// newClient never follows a redirect, so a droplet's 3xx reaches the
// browser, and has no cookie jar: one client serves every visitor, and a jar
// would hand the first visitor's cart and session to the next.
func newClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 10 * time.Second
	return &http.Client{
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func main() {
	client := newClient()
	shop, err := newShop(shopConfig{
		internalURL: getenv("SHOP_INTERNAL_URL", "http://localhost:8300"),
		publicURL:   getenv("SHOP_PUBLIC_URL", "http://localhost:8017"),
		client:      client,
		files:       files,
	})
	if err != nil {
		log.Fatal(err)
	}
	basic := &basicPage{
		// Server-to-server address (inside Docker: the service name).
		internalURL: strings.TrimRight(getenv("DROPLETS_INTERNAL_URL", "http://localhost:8000"), "/"),
		// Browser-facing address, written onto every fragment.
		publicURL: strings.TrimRight(getenv("DROPLETS_PUBLIC_URL", "http://localhost:8000"), "/"),
		client:    client,
		page:      template.Must(template.ParseFS(files, "templates/index.html")),
	}

	pages := http.NewServeMux()
	pages.Handle("GET /{$}", basic)
	shop.routes(pages)

	server := &http.Server{
		Addr:              ":" + getenv("PORT", "8017"),
		Handler:           shop.handler(pages),
		ReadHeaderTimeout: 10 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}
	log.Printf("listening on %s", server.Addr)
	log.Fatal(server.ListenAndServe())
}

// basicPage is `/`: the Svelte example's three droplets, fetched at once.
type basicPage struct {
	internalURL string
	publicURL   string
	client      *http.Client
	page        *template.Template
}

func (b *basicPage) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	who := "Go"
	if query := r.URL.Query(); query.Has("who") {
		who = query.Get("who")
	}
	fragments := make([]template.HTML, len(basicIDs))
	var wg sync.WaitGroup
	for i, id := range basicIDs {
		wg.Go(func() { fragments[i] = b.fetch(r.Context(), id, who) })
	}
	wg.Wait()
	render(w, b.page, "index.html", http.StatusOK, map[string]any{"PublicURL": b.publicURL, "Fragments": fragments})
}

// fetch is GET /droplets/<id>?who=<who>: the droplet element's fragment, or an inline error.
func (b *basicPage) fetch(ctx context.Context, id, who string) template.HTML {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	target := b.internalURL + "/droplets/" + url.PathEscape(id) + "?" + url.Values{"who": {who}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return unavailable(id, "")
	}
	req.Header.Set("accept", "text/html")
	req.Header.Set("x-droplet-location", b.publicURL)
	resp, err := b.client.Do(req)
	if err != nil {
		// The error names the internal URL: it goes to the log, not the page.
		log.Printf("[droplets] %s: %v", id, err)
		return unavailable(id, "")
	}
	defer resp.Body.Close()
	// Only an HTML answer is a fragment (a 500 carries the droplet's error
	// page); anything else may echo the props, so it is never pasted.
	if isFragment(resp) {
		if body, err := io.ReadAll(resp.Body); err == nil {
			return template.HTML(body)
		}
	}
	return unavailable(id, fmt.Sprintf(": HTTP %d", resp.StatusCode))
}

func unavailable(id, reason string) template.HTML {
	return template.HTML(fmt.Sprintf(`<p class="error">droplet "%s" unavailable%s</p>`, template.HTMLEscapeString(id), reason))
}

// isFragment says whether an answer is one to paste: a 2xx or 500, text/html.
func isFragment(resp *http.Response) bool {
	ok := resp.StatusCode/100 == 2 || resp.StatusCode == http.StatusInternalServerError
	return ok && strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html")
}

// render executes the template into memory first, so a template error
// answers 500 instead of half a page.
func render(w http.ResponseWriter, page *template.Template, name string, status int, data any) {
	var body strings.Builder
	if err := page.ExecuteTemplate(&body, name, data); err != nil {
		log.Printf("[render] %s: %v", name, err)
		http.Error(w, "The page could not be rendered.", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	io.WriteString(w, body.String())
}

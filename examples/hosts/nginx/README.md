# nginx: Server Side Includes, no application code

The host is a static `index.html`. nginx does two things:

- **SSI.** `<!--# include virtual="/droplets/ssr-hydrate?who=nginx" -->` makes nginx
  fetch the fragment while serving the page, so the browser receives
  server-rendered markup.
- **Reverse proxy.** `/index.js`, `/droplets/*`, `/assets/*` and `/api/*`
  are proxied to the droplets server. The browser only ever
  talks to nginx, so the droplets server needs no CORS, and `x-host` (nginx's
  public URL, written out in `nginx.conf`) tells it to write the fragments'
  URLs on nginx's origin. Droplets build their API calls
  from that origin (`$droplets/drop`), so `/api/*` has to go through too.

```bash
docker compose up --build
open http://localhost:8080
```

## The shop demo (`shop/`, port 8081)

A second `server` block serves the [shop example](../../shop) on
its own origin, `http://localhost:8081` (its `/index.js` and `/droplets/*`
would collide with the basic server's on 8080). Same two tools, no code:

- `/gallery`, `/product/<slug>`, `/login` and `/admin` are SSI pages in
  `shop/`, with one header and footer under `shop/_layout/`. Each include
  goes through the internal `/_fragment/` location, which sets `x-host`
  (written out), sends the page itself as `Referer` and keeps the browser's
  `Cookie` (subrequests carry it), so the cart badge and the admin render for
  the visitor. The page's query (`$args`) goes to the droplets that take it.
- Only a fragment is pasted: other error answers are replaced with a fixed
  note (`proxy_intercept_errors`), since they may echo the query.
- The product page reads the product's id, name and category from
  `/droplets/product-page/_data?slug=` into an SSI variable and picks them
  out with named captures; an `auth_request` to the same read answers 404
  for an unknown product.
- `/index.js`, `/droplets/*`, `/assets/*` and `/api/*` are proxied with the
  `Forwarded`/`X-Forwarded-*` headers cleared, so the login's `Set-Cookie`
  and 303, the cart cookie and the form posts pass through untouched.

```bash
docker compose up --build
open http://localhost:8081/gallery     # admin / droplets on /login
```

What SSI cannot do, with no way around it in stock nginx: an
`include virtual` is a subrequest, and nginx copies only its body into the
page. Its response headers are discarded, and no directive copies them to
the main response (`auth_request_set` reads headers from the one
`auth_request` subrequest per location, whose body is thrown away). So:

- a fragment's `Set-Cookie` never reaches the browser;
- its `Link` preloads do not either;
- its redirect is not passed on (the page renders without it).

The shop is fine with that: it sets cookies only on form actions and
`/api`, and those go through the proxy, which passes `Set-Cookie` and
`303`s on as they are. A droplet whose `load` sets a cookie on a plain
`GET`, or redirects, cannot be composed with SSI: render that page in code
instead (njs or OpenResty in nginx, or any of the other hosts here).

## IIS

[`iis/web.config`](./iis/web.config) is the equivalent URL Rewrite + ARR
reverse-proxy configuration. It has not been run on a Windows host; treat it
as a starting point. IIS cannot include arbitrary URLs server-side, so pair it
with a page that fetches fragments itself (any of the other examples) or with
the client-only pattern from [`react-vite`](../react-vite).

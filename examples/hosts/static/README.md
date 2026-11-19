# Static HTML

One static HTML page and a script, served by nginx with no proxy and no
server code. The script asks the [shop demo](../../shop)'s droplets server
for each fragment from the browser, on that server's own origin, and
inserts it; `/index.js`, loaded from the same server, makes every droplet
live. What a page on any static host (an object store, a CDN, GitHub Pages)
can do.

```bash
docker compose up --build
open http://localhost:8011/gallery
```

Set `SHOP_SECRET` and `DROPLETS_SECRET` first (32 or more random characters
each, `openssl rand -hex 32`), in the environment or a `.env` file beside
`docker-compose.yml`: compose refuses to start without them. `pnpm test:hosts`
generates its own for a run.

Compose starts two services: `shop` (the shop's droplets server, published
on http://localhost:8000, which the browser reaches directly) and `web`
(nginx, on http://localhost:8011). Both ports are published on `127.0.0.1`.

## Details

### The page

`html/index.html` is the only page: nginx answers `/gallery`,
`/product/<slug>`, `/admin` and `/login` with it, and `html/shop.js` reads
the path.

| Path | What `shop.js` asks the shop for |
| ---- | -------------------------------- |
| `/gallery` | `product-filter` and `product-library`, with the page's whole query |
| `/product/<slug>` | the product's id, name and category (`GET /droplets/product-page/_data?slug=`), then `product-page` (`slug`, `v` when the link has one) and `product-comments` (the id; `order`, `page`, `showing`) |
| `/admin` | `product-admin` (`view`, `id`) |
| `/login` | `login` (`next`) |

The toasts and the cart badge are elements the page writes itself
(`<djs-shop data-droplet="toast-center">`, `shopping-cart` with
`{"variant":"badge"}`), rendered in the browser. The layout is every shop
host's: the same `shop.css`, the header with Gallery, Admin and the cart,
the footer with the stack. `site.css` adds the placeholder. Without
JavaScript the page shows its header, footer and a note.

### Cross-origin, no proxy

- The page loads `http://localhost:8000/index.js`; every droplet then loads
  its bundle, stylesheet and data from there. `shop.js` reads that URL from
  the tag, so it is written once.
- Each fragment is a `fetch` with only an `Accept` header (no preflight),
  `credentials: "include"`, the page's whole URL as `Referer` (the shop
  takes the host page from it) and `redirect: "manual"`, inserted through a
  `<template>` when it is HTML (a 2xx, or a 500 or 504 with the droplet's error
  page); anything else shows "This droplet is unavailable.", since its text
  may echo the props.
- An old `v` answers a redirect, opaque here: `shop.js` drops `v` from the
  page's URL and asks again.
- The shop's `cors` (its own `droplets.config.ts`) answers an origin listed
  in `DROPLETS_TRUSTED_ORIGINS` by name, with
  `Access-Control-Allow-Credentials: true`, and any other origin with no
  CORS headers; it never answers `*`. Compose lists this page's origin
  there.
- With `credentials` in the shop's `cors`, the element's own requests (the
  enhanced form posts, `_data`, a fragment rendered again after a post)
  include the shop's cookies as well, and the shop's own `/api` calls
  already do (`examples/shop/src/lib/api.ts`). So the cart, the admin and
  the comments work here as on the proxied hosts.
- The login is a plain form post to the shop, a top-level navigation: its
  `Set-Cookie` is first-party there, and its 303 lands on this page's
  `/admin`.

### Cookies across sites

The page (`localhost:8011`) and the shop (`localhost:8000`) differ only by
port: two origins, one site, so the shop's `SameSite=Lax` cookies go along.
The same holds for `shop.example.com` and `drops.example.com`. A page on
another site (a site builder's domain) makes them third-party cookies:
they need `SameSite=None; Secure`, which the shop does not set, and
browsers block or partition them ([Site builders](https://dropletsjs.dev/integrate/hosts/site-builders/#cookies-across-sites)).

### Environment

`docker-compose.yml` reads `WEB_PORT` and `WEB_URL` (default 8011) and
`DROPLETS_PORT` and `DROPLETS_URL` (default 8000). The page names its
droplets server as `http://localhost:8000`; `nginx.conf` is a template whose
`sub_filter` rewrites that URL to `DROPLETS_PUBLIC_URL` when it differs.

### Changing this example

No code to compile and no `package.json`: `pnpm typecheck:hosts` skips it.
From the repository root, `pnpm test:hosts static` runs the shop flow
(`tests/hosts/e2e/shop.spec.ts`) and this page's own checks
(`tests/hosts/e2e/static.spec.ts`) against the compose stack (needs Docker).

## Facts

- Dockerfile is `nginx:1.27-alpine` with `nginx.conf` as a template and `html/` baked in. `Dockerfile:4`, `Dockerfile:5`, `Dockerfile:6`
- Compose shop service builds `examples/shop/Dockerfile` from the repository root and publishes `127.0.0.1:${DROPLETS_PORT:-8000}:8300`. `docker-compose.yml:13`, `docker-compose.yml:15`
- Compose shop `DROPLETS_TRUSTED_ORIGINS` is the page's origin, default `http://localhost:8011`: trusted, and answered by CORS with credentials. `docker-compose.yml:24`, `../../shop/droplets.config.ts:25`
- Compose web service publishes `127.0.0.1:${WEB_PORT:-8011}:80`; `DROPLETS_PUBLIC_URL` defaults to `http://localhost:8000`. `docker-compose.yml:30`, `docker-compose.yml:32`
- nginx proxies nothing; `/` answers 302 to `/gallery`. `nginx.conf:22`
- nginx answers `/gallery`, `/admin`, `/login` and `/product/<slug>` (slug `[a-z0-9]+(?:-[a-z0-9]+)*`) with `index.html`; any other path is a file or 404. `nginx.conf:27`, `nginx.conf:30`, `nginx.conf:33`, `nginx.conf:36`, `nginx.conf:40`
- `sub_filter` rewrites `http://localhost:8000` in HTML to `DROPLETS_PUBLIC_URL`. `nginx.conf:19`
- The page loads `http://localhost:8000/index.js` and `/shop.js` as modules. `html/index.html:12`, `html/index.html:13`
- The page writes `toast-center` first in `<body>`, and the `shopping-cart` badge in the header. `html/index.html:18`, `html/index.html:26`
- Footer stack label is `Static HTML`. `html/index.html:32`
- `shop.js` takes the droplets server's URL from the page's `/index.js` module script. `html/shop.js:11`, `html/shop.js:14`
- `shop.js` fetches every fragment with `credentials: "include"` and `referrerPolicy: "no-referrer-when-downgrade"`. `html/shop.js:31`, `html/shop.js:34`
- `shop.js` inserts a 2xx, 500 or 504 `text/html` answer only, else shows "This droplet is unavailable."; a redirect goes to `onRedirect`. `html/shop.js:36`, `html/shop.js:38`, `html/shop.js:39`
- `shop.js` passes the gallery's whole query to `product-filter` and `product-library`. `html/shop.js:87`
- `shop.js` reads the product from `/droplets/product-page/_data?slug=`; unknown, it shows "Not found". `html/shop.js:93`, `html/shop.js:109`
- `shop.js` drops `v` from the URL on a redirect and asks for `product-page` again. `html/shop.js:142`
- `shop.js` gives `/admin` `product-admin` with `view` and `id`, and `/login` `login` with `next`. `html/shop.js:153`, `html/shop.js:162`
- `pnpm test:hosts static` runs the shop flow and `e2e/static.spec.ts`, offset 11 in `hosts.json`. `../hosts.json`, `../../../tests/hosts/run.mjs`
- `examples/hosts/*` is outside the pnpm workspace. `../../../pnpm-workspace.yaml:5`

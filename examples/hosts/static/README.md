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

`html/index.html` is the only page: nginx answers `/gallery` and
`/product/<slug>` with it, and `html/shop.js` reads the path.

| Path | What `shop.js` asks the shop for |
| ---- | -------------------------------- |
| `/gallery` | `product-filter` and `product-library`, with the page's whole query |
| `/product/<slug>` | the product's id, name and category (`GET /droplets/product-page/_data?slug=`), then `product-page` (`slug`, `v` when the link has one) and `product-comments` (the id; `order`, `page`, `showing`) |

The toasts are an element the page writes itself
(`<djs-shop data-droplet="toast-center">`), rendered in the browser. The
layout is every shop host's: the same `shop.css`, the footer with the
stack. `site.css` adds the placeholder and the note under the hero.

### Cross-origin, no proxy

- The page loads `http://localhost:8000/index.js`; every droplet then loads
  its bundle, stylesheet and data from there. `shop.js` reads that URL from
  the tag, so it is written once.
- Each fragment is a `fetch` with only an `Accept` header (no preflight),
  `redirect: "manual"`, inserted through a `<template>` when it is HTML (a
  2xx, or a 500 with the droplet's error page); anything else shows "This
  droplet is unavailable.", since its text may echo the props.
- An old `v` answers a redirect, opaque here: `shop.js` drops `v` from the
  page's URL and asks again.
- The shop has `cors: true` (its own `droplets.config.ts`), and its
  `DROPLETS_TRUSTED_ORIGINS` is this page's origin.

### What it leaves out

A cross-origin request carries no cookies, and a `Set-Cookie` in its answer
is dropped: the shop's cart and admin need them, so the page has neither.
The shop's own browser code calls its `/api/*` with
`credentials: "include"` (`examples/shop/src/lib/api.ts`), which the browser
refuses against `access-control-allow-origin: *`: a change in the filter does
not refresh the library here, and the comments' own requests fail. A query
in the page's URL still narrows the library. Without JavaScript the page
shows its header, footer and a note. [React + Vite](../react-vite) and
[htmx](../htmx) proxy the shop under their own origin for the rest.

### Environment

`docker-compose.yml` reads `WEB_PORT` and `WEB_URL` (default 8011) and
`DROPLETS_PORT` and `DROPLETS_URL` (default 8000). The page names its
droplets server as `http://localhost:8000`; `nginx.conf` is a template whose
`sub_filter` rewrites that URL to `DROPLETS_PUBLIC_URL` when it differs.

### Changing this example

No code to compile and no `package.json`: `pnpm typecheck:hosts` skips it.
From the repository root, `pnpm test:hosts static` runs its flow
(`tests/hosts/e2e/static.spec.ts`) against the compose stack (needs Docker).

## Facts

- Dockerfile is `nginx:1.27-alpine` with `nginx.conf` as a template and `html/` baked in. `Dockerfile:4`, `Dockerfile:5`, `Dockerfile:6`
- Compose shop service builds `examples/shop/Dockerfile` from the repository root and publishes `127.0.0.1:${DROPLETS_PORT:-8000}:8300`. `docker-compose.yml:12`, `docker-compose.yml:14`
- Compose shop `DROPLETS_TRUSTED_ORIGINS` is the page's origin, default `http://localhost:8011`. `docker-compose.yml:22`
- Compose web service publishes `127.0.0.1:${WEB_PORT:-8011}:80`; `DROPLETS_PUBLIC_URL` defaults to `http://localhost:8000`. `docker-compose.yml:28`, `docker-compose.yml:30`
- nginx proxies nothing; `/` answers 302 to `/gallery`. `nginx.conf:22`
- nginx answers `/gallery` and `/product/<slug>` (slug `[a-z0-9]+(?:-[a-z0-9]+)*`) with `index.html`; any other path is a file or 404. `nginx.conf:27`, `nginx.conf:30`, `nginx.conf:34`
- `sub_filter` rewrites `http://localhost:8000` in HTML to `DROPLETS_PUBLIC_URL`. `nginx.conf:19`
- The page loads `http://localhost:8000/index.js` and `/shop.js` as modules. `html/index.html:12`, `html/index.html:13`
- The page writes `toast-center` first in `<body>`. `html/index.html:18`
- Footer stack label is `Static HTML`. `html/index.html:29`
- `shop.js` takes the droplets server's URL from the page's `/index.js` module script. `html/shop.js:7`, `html/shop.js:10`
- `shop.js` inserts a 2xx or 500 `text/html` answer only, else shows "This droplet is unavailable."; a redirect goes to `onRedirect`. `html/shop.js:28`, `html/shop.js:29`, `html/shop.js:37`
- `shop.js` passes the gallery's whole query to `product-filter` and `product-library`. `html/shop.js:62`
- `shop.js` reads the product from `/droplets/product-page/_data?slug=`; unknown, it shows "Not found". `html/shop.js:83`, `html/shop.js:94`
- `shop.js` drops `v` from the URL on a redirect and asks for `product-page` again. `html/shop.js:133`
- `pnpm test:hosts static` runs `e2e/static.spec.ts` alone, offset 11 in `hosts.json`. `../hosts.json`, `../../../tests/hosts/run.mjs`
- `examples/hosts/*` is outside the pnpm workspace. `../../../pnpm-workspace.yaml:5`

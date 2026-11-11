# Python (FastAPI)

A FastAPI app that embeds droplets. `main.py` fetches each fragment from the
droplets server with `httpx` and hands the HTML to a Jinja template, which
loads `/index.js` once. `shop.py` runs the [shop demo](../../shop) on
`/gallery`, `/product/<slug>`, `/login` and `/admin` through a same-origin
proxy.

```bash
docker compose up --build
open http://localhost:8001          # the three Svelte droplets
open http://localhost:8001/gallery  # the shop (demo login: admin / droplets)
```

Compose starts three services: `droplets` (the Svelte example, published on
http://localhost:8000), `shop` (reached only by the host) and `web` (this
app, on http://localhost:8001). Every port is published on `127.0.0.1`.

## Details

### The basic page (`/`)

`main.py` asks the droplets server for `client`, `ssr-hydrate` and
`ssr-nohydrate` concurrently (`asyncio.gather`) with the `who` query
(default `FastAPI`). It fetches from `DROPLETS_INTERNAL_URL` and sends
`DROPLETS_PUBLIC_URL` as `x-droplet-location`, so the fragments point the
browser at the public origin; `templates/index.html` loads `/index.js` from
that origin. The browser loads each droplet's JavaScript from
`http://localhost:8000`, a different origin than the page, so the droplets
server runs with `cors: true` (`examples/frameworks/svelte/droplets.config.ts`).

### The shop demo (`shop.py`)

- `/index.js`, `/droplets/*`, `/assets/*` and `/api/*` are proxied to the
  shop under this origin, bodies streamed both ways, so its cookies (the
  cart, the admin session) are first-party and nothing is cross-origin. The
  proxy forwards a fixed list of request headers (none that names a host)
  and passes `Set-Cookie` and redirects back untouched.
- `x-droplet-location` is `SHOP_PUBLIC_URL`, written out in the
  environment: never the request's Host. The shop lists that origin in
  `DROPLETS_TRUSTED_ORIGINS`.
- The pages fetch their fragments concurrently with the browser's `Cookie`,
  the page URL as `Referer`, and never follow redirects. Only an HTML answer
  (2xx or 500) is inserted, into the Jinja templates under
  `templates/shop/`. Their `Set-Cookie` goes back with the page, a droplet's
  redirect is answered as it is, and their `Link` preloads go into its
  `<head>`.
- One `httpx.AsyncClient` serves every visitor, so its cookie jar accepts
  no cookie: a shared jar would hand one visitor's cart and session to the
  next.
- The layout's stylesheet is `static/shop.css`, the same file in every host
  but WordPress.
- The contract the pages follow is [`CONTRACT.md`](../../shop/CONTRACT.md).

### Environment

| Variable | Service | Default in compose |
|---|---|---|
| `DROPLETS_INTERNAL_URL` | web | `http://droplets:8000` |
| `DROPLETS_PUBLIC_URL` | web | `${DROPLETS_URL:-http://localhost:8000}` |
| `SHOP_INTERNAL_URL` | web | `http://shop:8300` |
| `SHOP_PUBLIC_URL` | web | `${WEB_URL:-http://localhost:8001}` |
| `DROPLETS_TRUSTED_ORIGINS` | droplets | the droplets URL and this host's URL |
| `DROPLETS_TRUSTED_ORIGINS` | shop | this host's URL |

`WEB_PORT`, `WEB_URL`, `DROPLETS_PORT` and `DROPLETS_URL` move the published
ports and public URLs; `tests/hosts/run.mjs` sets them for
`HOSTS_PORT_BASE`.

### Without Docker

With a droplets server on port 8000 and, for `/gallery`, the shop on 8300
started with `DROPLETS_TRUSTED_ORIGINS=http://localhost:8001` (see the
[shop's README](../../shop/README.md)):

```bash
pip install -r requirements.txt
uvicorn main:app --port 8001
```

### Checks

From the repository root: `pnpm test:hosts fastapi` (the shop flow in
Chromium, against this compose stack). `pnpm typecheck:hosts` covers the
Node hosts only. The guide's page:
[FastAPI](https://dropletsjs.dev/integrate/hosts/fastapi/).

## Facts

- Web service publishes `127.0.0.1:${WEB_PORT:-8001}:8001`. `docker-compose.yml:37`
- Droplets service publishes `127.0.0.1:${DROPLETS_PORT:-8000}:8000`. `docker-compose.yml:11`
- Droplets service builds `examples/frameworks/Dockerfile` from the repository root (the Svelte example by default). `docker-compose.yml:9`, `../../frameworks/Dockerfile:24`
- Droplets service `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and `WEB_URL`. `docker-compose.yml:14`
- Droplets server (Svelte example) has `cors: true`. `../../frameworks/svelte/droplets.config.ts:16`
- Shop service builds `examples/shop/Dockerfile` and only exposes 8300, unpublished. `docker-compose.yml:21`, `docker-compose.yml:23`
- Shop service `DROPLETS_TRUSTED_ORIGINS` is `WEB_URL`. `docker-compose.yml:32`
- Shop demo login is `admin` / `droplets` (demo values only). `docker-compose.yml:26`, `docker-compose.yml:27`
- Shop service `DROPLETS_SECRET` is a demo value that signs a no-JavaScript form result. `docker-compose.yml:30`
- Web env `DROPLETS_INTERNAL_URL` is `http://droplets:8000`. `docker-compose.yml:39`
- Web env `DROPLETS_PUBLIC_URL` is `${DROPLETS_URL:-http://localhost:8000}`. `docker-compose.yml:40`
- Web env `SHOP_INTERNAL_URL` is `http://shop:8300`. `docker-compose.yml:41`
- Web env `SHOP_PUBLIC_URL` is `${WEB_URL:-http://localhost:8001}`. `docker-compose.yml:42`
- Dockerfile builds on `python:3.12-slim` and installs `requirements.txt` with pip. `Dockerfile:1`, `Dockerfile:4`
- Dockerfile runs `uvicorn main:app --host 0.0.0.0 --port 8001`. `Dockerfile:7`
- Dockerignore leaves out `.venv` and `__pycache__`. `.dockerignore:1`, `.dockerignore:2`
- Requirements are `fastapi>=0.115`, `httpx>=0.27`, `jinja2>=3.1`, `uvicorn[standard]>=0.30`; no droplets package. `requirements.txt:1`, `requirements.txt:4`
- Basic page `DROPLETS_INTERNAL_URL` and `DROPLETS_PUBLIC_URL` default to `http://localhost:8000`. `main.py:23`, `main.py:25`
- Basic page droplets are `client`, `ssr-hydrate`, `ssr-nohydrate`. `main.py:28`
- Basic page includes the shop router. `main.py:34`
- Basic page fragment fetch sends `x-droplet-location: DROPLETS_PUBLIC_URL`, timeout 5 s. `main.py:43`, `main.py:44`
- Basic page fragment failure (`httpx.HTTPError`, any non-2xx) renders an inline `<p class="error">`. `main.py:46`, `main.py:49`
- Basic page `who` defaults to `FastAPI`. `main.py:53`
- Basic page opens one `httpx.AsyncClient` per request and fetches the three fragments with `asyncio.gather`. `main.py:54`, `main.py:55`
- Basic page template loads `{{ droplets_public_url }}/index.js`. `templates/index.html:7`
- Shop footer stack name is `FastAPI`. `shop.py:27`
- Shop `SHOP_INTERNAL_URL` defaults to `http://localhost:8300`, trailing slashes stripped. `shop.py:30`
- Shop origin is scheme and host of `SHOP_PUBLIC_URL`, default `http://localhost:8001`. `shop.py:33`, `shop.py:34`
- Shop proxy forwards only `accept`, `accept-language`, `content-type`, `cookie`, `if-none-match`, `origin`, `referer`, `user-agent`, `x-droplet-props`, `x-droplets-build`. `shop.py:37`
- Shop proxy drops `connection`, `content-encoding`, `content-length`, `keep-alive`, `transfer-encoding` from the answer and re-appends `set-cookie`. `shop.py:51`, `shop.py:124`
- Shop httpx client is shared by every visitor, never follows redirects, timeout 10 s. `shop.py:66`, `shop.py:67`, `shop.py:68`
- Shop httpx client cookie jar accepts no domain: nothing is remembered between visitors. `shop.py:69`
- Shop proxy and fragment `Referer` use the raw path and query as the browser sent them. `shop.py:73`
- Shop proxy methods are `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`. `shop.py:89`
- Shop proxy routes are `/index.js`, `/droplets/*`, `/assets/*`, `/api/*`. `shop.py:92`, `shop.py:95`
- Shop `x-droplet-location` is the `SHOP_PUBLIC_URL` origin, never the request's Host. `shop.py:97`
- Shop proxy URL is concatenated, not resolved: `//elsewhere` stays a path on the shop. `shop.py:106`
- Shop proxy streams the request body and the answer. `shop.py:108`, `shop.py:111`
- Shop proxy answers 502 `The shop is unreachable.` when the shop is down. `shop.py:114`
- Shop proxy sends no body for `HEAD`. `shop.py:117`
- Shop fragment fetch sends `accept: text/html`, `x-droplet-location`, the page as `referer` and the browser's `cookie`. `shop.py:139`, `shop.py:142`
- Shop fragment 3xx keeps its `location`. `shop.py:151`
- Shop fragment inserted only when 2xx or 500 and `text/html`. `shop.py:152`
- Shop fragment otherwise renders `<p class="shop-unavailable">` with the id escaped (`Markup.format`). `shop.py:159`
- Shop product lookup reads `/droplets/product-page/_data?slug=` and needs string `id` and `name`. `shop.py:167`, `shop.py:175`
- Shop `Link` preloads kept only for `preload`/`modulepreload` on the public origin. `shop.py:197`, `shop.py:200`
- Shop pages always fetch `toast-center` and `shopping-cart` with `variant=badge`, concurrently. `shop.py:231`, `shop.py:233`
- Shop page redirect: the first fragment with a `location` answers the page with its status. `shop.py:238`, `shop.py:240`
- Shop pages answer `cache-control: private, no-store` and every fragment's `Set-Cookie`. `shop.py:257`, `shop.py:258`
- Shop stylesheet `/shop.css` is served from `static/shop.css` as `text/css`. `shop.py:265`, `shop.py:267`
- Gallery passes the whole query to `product-filter` and `product-library`. `shop.py:279`
- Product page answers 404 when the product is not found. `shop.py:287`
- Product page comments props are `order`, `page`, `showing` plus `productId`. `shop.py:288`
- Product page props are `slug` plus `v` (when the link had one). `shop.py:291`
- Login page passes `next`. `shop.py:306`
- Admin page passes `view` and `id`. `shop.py:317`
- Shop layout loads `/shop.css` and `/index.js` from this origin. `templates/shop/layout.html:7`, `templates/shop/layout.html:12`
- Shop layout speculation rules prefetch `/product/*`, eagerness `moderate`. `templates/shop/layout.html:11`
- Shop layout puts the toasts fragment first in the body. `templates/shop/layout.html:15`
- Typecheck: no `package.json`, so `pnpm typecheck:hosts` does not cover this host. `../../../tests/hosts/typecheck.mjs:20`
- Host test URL is `http://localhost:8001`; `pnpm test:hosts fastapi` runs the shop flow. `../../../tests/hosts/run.mjs:60`
- Host test checks a new visitor gets nobody else's cart or session. `../../../tests/hosts/e2e/shop.spec.ts:280`

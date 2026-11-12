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

Set `SHOP_SECRET` and `DROPLETS_SECRET` first (32 or more random characters
each, `openssl rand -hex 32`), in the environment or a `.env` file beside
`docker-compose.yml`: compose refuses to start without them. `pnpm test:hosts`
generates its own for a run.

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

- `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*` and `/api/*` are proxied to the
  shop under this origin, bodies streamed both ways, so its cookies (the
  cart, the admin session) are first-party and nothing is cross-origin. The
  proxy forwards a fixed list of request headers (none that names a host)
  and passes `Set-Cookie` and redirects back untouched.
- `x-droplet-location` is `SHOP_PUBLIC_URL`, written out in the
  environment: never the request's Host. The shop lists that origin in
  `DROPLETS_TRUSTED_ORIGINS`.
- The pages fetch their fragments concurrently with the browser's `Cookie`
  cut down to the shop's own `cart_id` and `shop_admin` (so does the proxy,
  which also refuses a path with a `.` or `..` segment once decoded),
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
- Shop service `SHOP_SECRET` and `DROPLETS_SECRET` are required from the environment (`${VAR:?…}`), no default. `docker-compose.yml:28`, `docker-compose.yml:30`
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
- Basic page fragment fetch sends `accept: text/html` and `x-droplet-location: DROPLETS_PUBLIC_URL`, timeout 5 s, no redirect followed. `main.py:44`, `main.py:45`
- Basic page fragment failure (`httpx.HTTPError`) is logged and renders a fixed inline `<p class="error">`: the error names the internal URL. `main.py:47`, `main.py:49`, `main.py:50`
- Basic page pastes only a 2xx or 500 `text/html` answer; anything else renders `<p class="error">` with the status, the id escaped by `Markup.format`. `main.py:53`, `main.py:54`, `main.py:56`
- Basic page `who` defaults to `FastAPI`. `main.py:60`
- Basic page opens one `httpx.AsyncClient` per request and fetches the three fragments with `asyncio.gather`. `main.py:61`, `main.py:62`
- Basic page template loads `{{ droplets_public_url }}/index.js`. `templates/index.html:7`
- Shop footer stack name is `FastAPI`. `shop.py:27`
- Shop `SHOP_INTERNAL_URL` defaults to `http://localhost:8300`, trailing slashes stripped. `shop.py:30`
- Shop origin is scheme and host of `SHOP_PUBLIC_URL`, default `http://localhost:8001`. `shop.py:33`, `shop.py:34`
- Shop proxy forwards only `accept`, `accept-language`, `content-type`, `if-none-match`, `origin`, `referer`, `user-agent`, `x-droplet-props`, `x-droplets-build`, plus `cookie` cut down to `cart_id` and `shop_admin` (`SHOP_COOKIES`). `shop.py:37`, `shop.py:60`, `shop.py:121`
- Shop proxy refuses a path with a `.` or `..` segment, once decoded, with 400. `shop.py:89`, `shop.py:114`
- Shop proxy drops `connection`, `content-encoding`, `content-length`, `keep-alive`, `transfer-encoding` from the answer and re-appends `set-cookie`. `shop.py:50`, `shop.py:146`
- Shop httpx client is shared by every visitor, never follows redirects, timeout 10 s. `shop.py:68`, `shop.py:69`, `shop.py:70`
- Shop httpx client cookie jar accepts no domain: nothing is remembered between visitors. `shop.py:71`
- Shop proxy and fragment `Referer` use the raw path and query as the browser sent them. `shop.py:75`
- Shop proxy methods are `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`. `shop.py:104`
- Shop proxy routes are `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*`. `shop.py:107`, `shop.py:112`
- Shop `x-droplet-location` is the `SHOP_PUBLIC_URL` origin, never the request's Host. `shop.py:116`
- Shop proxy URL is concatenated, not resolved: `//elsewhere` stays a path on the shop. `shop.py:128`
- Shop proxy streams the request body and the answer. `shop.py:130`, `shop.py:133`
- Shop proxy answers 502 `The shop is unreachable.` when the shop is down. `shop.py:136`
- Shop proxy sends no body for `HEAD`. `shop.py:139`
- Shop fragment fetch sends `accept: text/html`, `x-droplet-location`, the page as `referer` and the browser's `cookie` cut down to the shop's. `shop.py:161`, `shop.py:162`
- Shop fragment 3xx keeps its `location`. `shop.py:173`
- Shop fragment inserted only when 2xx or 500 and `text/html`. `shop.py:174`
- Shop fragment otherwise renders `<p class="shop-unavailable">` with the id escaped (`Markup.format`). `shop.py:181`
- Shop product lookup reads `/droplets/product-page/_data?slug=` and needs string `id` and `name`. `shop.py:189`, `shop.py:197`
- Shop `Link` preloads kept only for `preload`/`modulepreload` on the public origin. `shop.py:219`, `shop.py:222`
- Shop pages always fetch `toast-center` and `shopping-cart` with `variant=badge`, concurrently. `shop.py:253`, `shop.py:255`
- Shop page redirect: the first fragment with a `location` answers the page with its status. `shop.py:260`, `shop.py:262`
- Shop pages answer `cache-control: private, no-store` and every fragment's `Set-Cookie`. `shop.py:279`, `shop.py:280`
- Shop stylesheet `/shop.css` is served from `static/shop.css` as `text/css`. `shop.py:287`, `shop.py:289`
- Gallery passes the whole query to `product-filter` and `product-library`. `shop.py:301`
- Product page answers 404 when the product is not found. `shop.py:309`
- Product page comments props are `order`, `page`, `showing` plus `productId`. `shop.py:310`
- Product page props are `slug` plus `v` (when the link had one). `shop.py:313`
- Login page passes `next`. `shop.py:328`
- Admin page passes `view` and `id`. `shop.py:339`
- Shop layout loads `/shop.css` and `/index.js` from this origin. `templates/shop/layout.html:7`, `templates/shop/layout.html:12`
- Shop layout speculation rules prefetch `/product/*`, eagerness `moderate`. `templates/shop/layout.html:11`
- Shop layout puts the toasts fragment first in the body. `templates/shop/layout.html:15`
- Typecheck: no `package.json`, so `pnpm typecheck:hosts` does not cover this host. `../../../tests/hosts/typecheck.mjs:20`
- Host test URL is `http://localhost:8001`; `pnpm test:hosts fastapi` runs the shop flow. `../../../tests/hosts/run.mjs:60`
- Host test checks a new visitor gets nobody else's cart or session. `../../../tests/hosts/e2e/shop.spec.ts:280`

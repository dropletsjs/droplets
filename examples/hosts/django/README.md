# Python (Django)

A Django project that embeds droplets. `basic/views.py` fetches each
fragment from the droplets server with `httpx` and hands the HTML to a
Django template, which loads `/index.js` once. The `shop` app runs the
[shop demo](../../shop) on `/gallery`, `/product/<slug>`, `/login` and
`/admin`, with a same-origin proxy (`shop/proxy.py`) for everything else the
browser asks the shop for.

```bash
docker compose up --build
open http://localhost:8012          # the three Svelte droplets
open http://localhost:8012/gallery  # the shop (demo login: admin / droplets)
```

Set `SHOP_SECRET` and `DROPLETS_SECRET` first (32 or more random characters
each, `openssl rand -hex 32`), in the environment or a `.env` file beside
`docker-compose.yml`: compose refuses to start without them. `pnpm test:hosts`
generates its own for a run.

Compose starts three services: `droplets` (the Svelte example, published on
http://localhost:8000), `shop` (reached only by the host) and `web` (this
project under gunicorn, on http://localhost:8012). Every port is published
on `127.0.0.1`.

## Details

### The layout

- `config/`: the settings, the root URLconf and the WSGI entry. No
  database, no sessions, no auth: nothing here stores or signs anything.
- `basic/`: the basic page (`/`), one view and its template.
- `shop/`: the shop's pages (`views.py`), the proxy (`proxy.py`), what both
  share (`upstream.py`: the one `httpx.Client`, the public origin, the
  cookie filter), the templates under `templates/shop/` and the tests
  (`tests.py`).

### The basic page (`/`)

`basic/views.py` asks the droplets server for `client`, `ssr-hydrate` and
`ssr-nohydrate` at once (a `ThreadPoolExecutor`) with the `who` query
(default `Django`). It fetches from `DROPLETS_INTERNAL_URL` and sends
`DROPLETS_PUBLIC_URL` as `x-droplet-location`, so the fragments point the
browser at the public origin; `basic/templates/basic/index.html` loads
`/index.js` from that origin. The browser loads each droplet's JavaScript
from `http://localhost:8000`, a different origin than the page, so the
droplets server runs with `cors: true`
(`examples/frameworks/svelte/droplets.config.ts`).

### The shop demo (`shop/`)

- `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*` and
  `/api/*` go to one view, `proxy`, which passes them on to the shop under
  this origin, so its cookies (the cart, the admin session) are
  first-party and nothing is cross-origin. It forwards a fixed list of
  request headers (none that names a host) and passes `Set-Cookie` and
  redirects back untouched; the answer is streamed
  (`StreamingHttpResponse`).
- Before the body is read, the proxy refuses a method it does not proxy
  (`405`), a path with a `.` or `..` segment (`400`) and a body over
  `DATA_UPLOAD_MAX_MEMORY_SIZE` (`413`, 4 MiB: above the shop's own 3 MiB
  limit for uploads).
- The proxy is `csrf_exempt`: the shop checks a form post's `Origin`
  itself, and a Django CSRF token would mean nothing to it.
  `CsrfViewMiddleware` stays on for the project's own forms.
- `x-droplet-location` is the origin of `SHOP_PUBLIC_URL`, from the
  settings: never the request's Host. The shop lists that origin in
  `DROPLETS_TRUSTED_ORIGINS`.
- The pages fetch their fragments at once (a `ThreadPoolExecutor`) with
  the browser's `Cookie` cut down to the shop's own `cart_id` and
  `shop_admin` (so does the proxy), the page URL as `Referer`, and never
  follow redirects. Only an HTML answer (2xx or 500) is inserted, with
  `mark_safe`, into the templates under `templates/shop/`. Their
  `Set-Cookie` goes back with the page, a droplet's redirect is answered as
  it is, and their `Link` preloads go into its `<head>`.
- A Django response keeps one value per header name, and writes several
  `Set-Cookie` lines only from `response.cookies`. `pass_set_cookies` puts
  each line the shop sent there as it came, in a `Morsel` that writes the
  line out unparsed, so nothing is rewritten.
- One `httpx.Client` serves every visitor and thread, so its cookie jar
  accepts no cookie: a shared jar would hand one visitor's cart and session
  to the next.
- The layout's stylesheet is `shop/static/shop.css`, served on `/shop.css`
  by a view: the same file in every host but WordPress.
- The contract the pages follow is [`CONTRACT.md`](../../shop/CONTRACT.md).

### Environment

| Variable | Service | Default in compose |
|---|---|---|
| `DROPLETS_INTERNAL_URL` | web | `http://droplets:8000` |
| `DROPLETS_PUBLIC_URL` | web | `${DROPLETS_URL:-http://localhost:8000}` |
| `SHOP_INTERNAL_URL` | web | `http://shop:8300` |
| `SHOP_PUBLIC_URL` | web | `${WEB_URL:-http://localhost:8012}` |
| `DJANGO_ALLOWED_HOSTS` | web | unset: `localhost,127.0.0.1` |
| `DJANGO_SECRET_KEY` | web | unset: a random key per process |
| `DROPLETS_TRUSTED_ORIGINS` | droplets | the droplets URL and this host's URL |
| `DROPLETS_TRUSTED_ORIGINS` | shop | this host's URL |

`WEB_PORT`, `WEB_URL`, `DROPLETS_PORT` and `DROPLETS_URL` move the published
ports and public URLs; `tests/hosts/run.mjs` sets them for
`HOSTS_PORT_BASE`. Served under another name than `localhost`, set
`DJANGO_ALLOWED_HOSTS` to it: Django answers `400` to any other `Host`.

### Without Docker

With a droplets server on port 8000 and, for `/gallery`, the shop on 8300
started with `DROPLETS_TRUSTED_ORIGINS=http://localhost:8012` (see the
[shop's README](../../shop/README.md)):

```bash
pip install -r requirements.txt
python manage.py test
gunicorn config.wsgi --bind 127.0.0.1:8012 --threads 8
```

### Checks

`python manage.py test` runs `shop/tests.py` against a stand-in shop
(`httpx.MockTransport`); the Docker build runs it too, so a failing test
stops `docker compose up --build`. From the repository root:
`pnpm test:hosts django` (the shop flow in Chromium, against this compose
stack). `pnpm typecheck:hosts` covers the Node hosts only. The guide's
page: [Django](https://dropletsjs.dev/integrate/hosts/django/).

## Facts

- Web service publishes `127.0.0.1:${WEB_PORT:-8012}:8012`. `docker-compose.yml:37`
- Droplets service publishes `127.0.0.1:${DROPLETS_PORT:-8000}:8000`. `docker-compose.yml:11`
- Droplets service builds `examples/frameworks/Dockerfile` from the repository root (the Svelte example by default). `docker-compose.yml:9`, `../../frameworks/Dockerfile:24`
- Droplets service `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and `WEB_URL`. `docker-compose.yml:14`
- Droplets server (Svelte example) has `cors: true`. `../../frameworks/svelte/droplets.config.ts:16`
- Shop service builds `examples/shop/Dockerfile` and only exposes 8300, unpublished. `docker-compose.yml:21`, `docker-compose.yml:23`
- Shop service `DROPLETS_TRUSTED_ORIGINS` is `WEB_URL`, default `http://localhost:8012`. `docker-compose.yml:32`
- Shop demo login is `admin` / `droplets` (demo values only). `docker-compose.yml:26`, `docker-compose.yml:27`
- Shop service `SHOP_SECRET` and `DROPLETS_SECRET` are required from the environment (`${VAR:?…}`), no default. `docker-compose.yml:28`, `docker-compose.yml:30`
- Web env `DROPLETS_INTERNAL_URL` is `http://droplets:8000`. `docker-compose.yml:39`
- Web env `DROPLETS_PUBLIC_URL` is `${DROPLETS_URL:-http://localhost:8000}`. `docker-compose.yml:40`
- Web env `SHOP_INTERNAL_URL` is `http://shop:8300`. `docker-compose.yml:41`
- Web env `SHOP_PUBLIC_URL` is `${WEB_URL:-http://localhost:8012}`. `docker-compose.yml:42`
- Dockerfile builds on `python:3.14-slim` and installs `requirements.txt` with pip. `Dockerfile:1`, `Dockerfile:5`
- Dockerfile runs `python manage.py test` in the build: a failing test fails the image. `Dockerfile:8`
- Dockerfile runs `gunicorn config.wsgi` on `0.0.0.0:8012`, 2 workers of 8 threads, access log to stdout. `Dockerfile:10`
- Dockerignore leaves out `.venv` and `__pycache__`. `.dockerignore:1`, `.dockerignore:2`
- Requirements are `Django>=6.1,<6.2`, `gunicorn>=23`, `httpx>=0.28`; no droplets package. `requirements.txt:1`, `requirements.txt:3`
- Settings: `DEBUG` off, a random `SECRET_KEY` per process unless `DJANGO_SECRET_KEY` is set. `config/settings.py:13`, `config/settings.py:14`
- Settings `ALLOWED_HOSTS` from `DJANGO_ALLOWED_HOSTS`, default `localhost,127.0.0.1`. `config/settings.py:15`
- Settings: no database (`DATABASES = {}`), apps `basic` and `shop` only. `config/settings.py:17`, `config/settings.py:31`
- Middleware: `SecurityMiddleware`, `CommonMiddleware`, `CsrfViewMiddleware`, `XFrameOptionsMiddleware`. `config/settings.py:21`
- `DATA_UPLOAD_MAX_MEMORY_SIZE` is 4 MiB. `config/settings.py:36`
- Logging prints warnings and errors to stderr; `django.request` errors only. `config/settings.py:39`
- Settings `DROPLETS_INTERNAL_URL` and `DROPLETS_PUBLIC_URL` default to `http://localhost:8000`, trailing slashes stripped. `config/settings.py:48`, `config/settings.py:49`
- Settings `SHOP_INTERNAL_URL` defaults to `http://localhost:8300`, trailing slashes stripped. `config/settings.py:52`
- Settings `SHOP_PUBLIC_URL` defaults to `http://localhost:8012`. `config/settings.py:53`
- Root URLconf: `/` is the basic page, the rest is `shop.urls`. `config/urls.py:6`, `config/urls.py:8`
- Basic page droplets are `client`, `ssr-hydrate`, `ssr-nohydrate`. `basic/views.py:26`
- Basic page fragment fetch sends `accept: text/html` and `x-droplet-location: DROPLETS_PUBLIC_URL`, no redirect followed. `basic/views.py:33`, `basic/views.py:36`
- Basic page fragment failure (`httpx.HTTPError`) is logged and renders a fixed inline `<p class="error">`: the error names the internal URL. `basic/views.py:41`
- Basic page pastes only a 2xx or 500 `text/html` answer; anything else renders `<p class="error">` with the status, the id escaped by `format_html`. `basic/views.py:45`, `basic/views.py:47`
- Basic page answers `GET` and `HEAD`; `who` defaults to `Django`. `basic/views.py:50`, `basic/views.py:52`
- Basic page opens one `httpx.Client` per request (timeout 5 s) and fetches the three fragments in a thread pool. `basic/views.py:53`
- Basic page template loads `{{ droplets_public_url }}/index.js`. `basic/templates/basic/index.html:7`
- Shop footer stack name is `Django`. `shop/upstream.py:14`
- Shop origin is scheme and host of `SHOP_PUBLIC_URL`. `shop/upstream.py:19`, `shop/upstream.py:20`
- Shop cookies sent to the shop are `cart_id` and `shop_admin` only. `shop/upstream.py:23`, `shop/upstream.py:36`
- Shop httpx client is shared by every visitor and thread, never follows redirects, timeout 10 s. `shop/upstream.py:29`, `shop/upstream.py:30`, `shop/upstream.py:31`
- Shop httpx client cookie jar accepts no domain: nothing is remembered between visitors. `shop/upstream.py:32`
- Shop `Set-Cookie` lines go onto `response.cookies` as `Morsel`s that write the line unparsed, one key each. `shop/upstream.py:43`, `shop/upstream.py:54`
- Shop proxy routes are `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*`. `shop/urls.py:7`, `shop/urls.py:10`
- Shop proxy methods are `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`; any other answers 405. `shop/proxy.py:18`, `shop/proxy.py:72`
- Shop proxy forwards only `accept`, `accept-language`, `content-type`, `if-none-match`, `origin`, `referer`, `user-agent`, `x-droplet-props`, `x-droplets-build`, plus `cookie` cut down to the shop's. `shop/proxy.py:21`, `shop/proxy.py:87`
- Shop proxy drops `connection`, `content-encoding`, `content-length`, `date`, `keep-alive`, `transfer-encoding` from the answer and passes `set-cookie` on line by line. `shop/proxy.py:35`, `shop/proxy.py:110`
- Shop proxy is `csrf_exempt`. `shop/proxy.py:71`
- Shop proxy refuses a path with a `.` or `..` segment, once decoded, with 400. `shop/proxy.py:50`, `shop/proxy.py:76`
- Shop proxy refuses a body over `DATA_UPLOAD_MAX_MEMORY_SIZE` with 413, before reading it. `shop/proxy.py:79`
- Shop `x-droplet-location` is the `SHOP_PUBLIC_URL` origin, never the request's Host. `shop/proxy.py:82`, `shop/views.py:63`
- Shop proxy URL is concatenated, not resolved: `//elsewhere` stays a path on the shop. `shop/proxy.py:93`
- Shop proxy buffers the request body (`request.body`) and streams the answer. `shop/proxy.py:95`, `shop/proxy.py:103`
- Shop proxy answers 502 `The shop is unreachable.` when the shop is down. `shop/proxy.py:101`
- Shop proxy joins a repeated answer header with `, `, Set-Cookie aside. `shop/proxy.py:107`
- Shop fragment 3xx keeps its `location`. `shop/views.py:46`
- Shop fragment inserted only when 2xx or 500 and `text/html`, with `mark_safe`. `shop/views.py:48`
- Shop fragment otherwise renders `<p class="shop-unavailable">` with the id escaped (`format_html`). `shop/views.py:55`
- Shop fragment fetch sends `accept: text/html`, `x-droplet-location`, the page (`get_full_path()`) as `referer` and the browser's `cookie` cut down to the shop's. `shop/views.py:59`, `shop/views.py:64`
- Shop product lookup reads `/droplets/product-page/_data?slug=` and needs string `id` and `name`. `shop/views.py:74`
- Shop `Link` preloads kept only for `preload`/`modulepreload` on the public origin. `shop/views.py:92`
- Shop pages always fetch `toast-center` and `shopping-cart` with `variant=badge`, all fragments in a thread pool. `shop/views.py:133`
- Shop page redirect: the first fragment with a `location` answers the page with its status. `shop/views.py:136`, `shop/views.py:138`
- Shop pages answer `cache-control: private, no-store` and every fragment's `Set-Cookie`. `shop/views.py:155`, `shop/views.py:156`
- Shop pages answer `GET` and `HEAD` (`require_safe`). `shop/views.py:168`
- Shop stylesheet `/shop.css` is served from `shop/static/shop.css` as `text/css`. `shop/views.py:26`, `shop/views.py:165`
- Gallery passes the whole query to `product-filter` and `product-library`. `shop/views.py:171`
- Product page answers 404 when the product is not found. `shop/views.py:185`
- Product page comments props are `order`, `page`, `showing` plus `productId`. `shop/views.py:186`
- Product page props are `slug` plus `v` (when the link had one). `shop/views.py:189`
- Login page passes `next`. `shop/views.py:204`
- Admin page passes `view` and `id`. `shop/views.py:215`
- Shop layout loads `/shop.css` and `/index.js` from this origin. `shop/templates/shop/layout.html:7`, `shop/templates/shop/layout.html:10`
- Shop layout speculation rules prefetch `/product/*`, eagerness `moderate`. `shop/templates/shop/layout.html:9`
- Shop layout puts the toasts fragment first in the body. `shop/templates/shop/layout.html:13`
- Tests run against `httpx.MockTransport`, no shop needed. `shop/tests.py:22`, `shop/tests.py:40`
- Tests check the proxy refuses dot segments, other methods and large bodies before asking the shop. `shop/tests.py:98`, `shop/tests.py:104`, `shop/tests.py:109`
- Tests check every `Set-Cookie` line reaches the WSGI server untouched. `shop/tests.py:125`
- Typecheck: no `package.json`, so `pnpm typecheck:hosts` does not cover this host. `../../../tests/hosts/typecheck.mjs:20`
- Host test URL is `http://localhost:8012`; `pnpm test:hosts django` runs the shop flow. `../../../tests/hosts/run.mjs:68`
- Host test checks a new visitor gets nobody else's cart or session. `../../../tests/hosts/e2e/shop.spec.ts:288`

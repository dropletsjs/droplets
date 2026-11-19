# Go (net/http)

A Go server that embeds droplets with the standard library alone: no
module outside it, so `go.mod` has no `require`. `main.go` fetches each
fragment from the droplets server with `net/http` and hands the HTML to an
`html/template` as `template.HTML`; the page loads `/index.js` once.
`shop.go` runs the [shop demo](../../shop) on `/gallery`, `/product/<slug>`,
`/login` and `/admin` through a same-origin proxy.

```bash
docker compose up --build
open http://localhost:8017          # the three Svelte droplets
open http://localhost:8017/gallery  # the shop (demo login: admin / droplets)
```

Set `SHOP_SECRET` and `DROPLETS_SECRET` first (32 or more random characters
each, `openssl rand -hex 32`), in the environment or a `.env` file beside
`docker-compose.yml`: compose refuses to start without them. `pnpm test:hosts`
generates its own for a run.

Compose starts three services: `droplets` (the Svelte example, published on
http://localhost:8000), `shop` (reached only by the host) and `web` (this
server, on http://localhost:8017). Every port is published on `127.0.0.1`.

## Details

### The basic page (`/`)

`main.go` asks the droplets server for `client`, `ssr-hydrate` and
`ssr-nohydrate` at once (a goroutine each, `sync.WaitGroup.Go`) with the
`who` query (default `Go`). It fetches from `DROPLETS_INTERNAL_URL` and
sends `DROPLETS_PUBLIC_URL` as `x-droplet-location`, so the fragments point
the browser at the public origin; `templates/index.html` loads `/index.js`
from that origin. The browser loads each droplet's JavaScript from
`http://localhost:8000`, a different origin than the page, so the droplets
server runs with `cors: true` (`examples/frameworks/svelte/droplets.config.ts`).

### The shop demo (`shop.go`)

- `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*` and
  `/api/*` are proxied to the shop under this origin, bodies streamed both
  ways, so its cookies (the cart, the admin session) are first-party and
  nothing is cross-origin. The proxy forwards a fixed list of request
  headers (none that names a host) and passes `Set-Cookie` and redirects
  back untouched. It answers these paths before the pages' `ServeMux`, which
  would redirect a path with a dot segment instead of refusing it.
- `x-droplet-location` is the origin of `SHOP_PUBLIC_URL`, written out in
  the environment: never the request's Host. The shop lists that origin in
  `DROPLETS_TRUSTED_ORIGINS`.
- The pages fetch their fragments at once with the browser's `Cookie` cut
  down to the shop's own `cart_id` and `shop_admin` (so does the proxy,
  which also refuses a path with a `.` or `..` segment once decoded, a
  method off its list and a body over 4 MiB), the page URL as `Referer`, and
  never follow redirects. Only an HTML answer (2xx or 500) is inserted, into
  the templates under `templates/shop/`. Their `Set-Cookie` goes back with
  the page, a droplet's redirect is answered as it is, and their `Link`
  preloads go into its `<head>`.
- One `http.Client` serves every visitor. It has no cookie jar, so nothing
  is remembered between visitors, and its `CheckRedirect` answers
  `http.ErrUseLastResponse`, so a 3xx reaches the browser.
- The templates and `static/shop.css` are embedded (`//go:embed`): the
  binary is the whole app, and the image that runs it holds nothing else.
- The layout's stylesheet is `static/shop.css`, the same file in every host
  but WordPress.
- The contract the pages follow is [`CONTRACT.md`](../../shop/CONTRACT.md).

### Environment

| Variable | Service | Default in compose |
|---|---|---|
| `DROPLETS_INTERNAL_URL` | web | `http://droplets:8000` |
| `DROPLETS_PUBLIC_URL` | web | `${DROPLETS_URL:-http://localhost:8000}` |
| `SHOP_INTERNAL_URL` | web | `http://shop:8300` |
| `SHOP_PUBLIC_URL` | web | `${WEB_URL:-http://localhost:8017}` |
| `PORT` | web | unset: `8017` |
| `DROPLETS_TRUSTED_ORIGINS` | droplets | the droplets URL and this host's URL |
| `DROPLETS_TRUSTED_ORIGINS` | shop | this host's URL |

`WEB_PORT`, `WEB_URL`, `DROPLETS_PORT` and `DROPLETS_URL` move the published
ports and public URLs; `tests/hosts/run.mjs` sets them for
`HOSTS_PORT_BASE`.

### Without Docker

With Go 1.27 or later, a droplets server on port 8000 and, for `/gallery`,
the shop on 8300 started with `DROPLETS_TRUSTED_ORIGINS=http://localhost:8017`
(see the [shop's README](../../shop/README.md)):

```bash
go test ./...
go run .
```

### Checks

`go vet` and `go test` run in the image's build stage, so a failing test
stops `docker compose up --build`. `shop_test.go` runs the host against a
stand-in shop (`httptest`): the refused dot segments, methods and bodies,
the forwarded headers, a fragment that is not HTML, a fragment's redirect, a
product out of shape and the `Link` preloads. From the repository root:
`pnpm test:hosts go` (the shop flow in Chromium, against this compose
stack). `pnpm typecheck:hosts` covers the Node hosts only. The guide's page:
[Go](https://dropletsjs.dev/integrate/hosts/go/).

## Facts

- Web service publishes `127.0.0.1:${WEB_PORT:-8017}:8017`. `docker-compose.yml:37`
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
- Web env `SHOP_PUBLIC_URL` is `${WEB_URL:-http://localhost:8017}`. `docker-compose.yml:42`
- Module is `droplets-go-host`, `go 1.27`, no `require`: the standard library only. `go.mod:1`, `go.mod:3`
- Dockerfile builds on `golang:1.27-alpine`, runs `go vet` and `go test`, then builds a static binary (`CGO_ENABLED=0`). `Dockerfile:2`, `Dockerfile:3`, `Dockerfile:9`
- Dockerfile runs the binary on `gcr.io/distroless/static-debian13:nonroot`, port 8017. `Dockerfile:11`, `Dockerfile:13`, `Dockerfile:14`
- Templates and `static/` are embedded in the binary. `main.go:24`
- Server listens on `:` plus `PORT`, default `8017`. `main.go:76`
- Server reads headers for at most 10 s and 64 KiB (Go answers 431 beyond). `main.go:78`, `main.go:79`
- Client is shared by every visitor, has no cookie jar and never follows a redirect (`http.ErrUseLastResponse`). `main.go:45`
- Client waits at most 10 s for the shop's response headers. `main.go:42`
- Basic page `DROPLETS_INTERNAL_URL` and `DROPLETS_PUBLIC_URL` default to `http://localhost:8000`, trailing slashes stripped. `main.go:64`, `main.go:66`
- Basic page droplets are `client`, `ssr-hydrate`, `ssr-nohydrate`. `main.go:28`
- Basic page is `GET /{$}`, the root alone. `main.go:72`
- Basic page `who` defaults to `Go` when the query has none. `main.go:94`
- Basic page fetches the three fragments at once, a goroutine each. `main.go:101`
- Basic page fragment fetch sends `accept: text/html` and `x-droplet-location: DROPLETS_PUBLIC_URL`, timeout 5 s. `main.go:109`, `main.go:116`, `main.go:117`
- Basic page fragment failure is logged and renders a fixed inline `<p class="error">`: the error names the internal URL. `main.go:121`
- Basic page pastes only a 2xx or 500 `text/html` answer; anything else renders `<p class="error">` with the status, the id escaped. `main.go:132`, `main.go:140`
- Pages are executed into memory first; a template error answers 500 `The page could not be rendered.`. `main.go:147`
- Basic page template loads `{{.PublicURL}}/index.js`. `templates/index.html:7`
- Shop footer stack name is `Go`. `shop.go:32`
- Shop `SHOP_INTERNAL_URL` defaults to `http://localhost:8300`, trailing slashes stripped. `main.go:54`, `shop.go:102`
- Shop origin is scheme and host of `SHOP_PUBLIC_URL`, default `http://localhost:8017`; a URL without both fails at start. `main.go:55`, `shop.go:103`
- Shop proxy forwards only `Accept`, `Accept-Language`, `Content-Type`, `If-None-Match`, `Origin`, `Referer`, `User-Agent`, `X-Droplet-Props`, `X-Droplets-Build`, plus `Cookie` cut down to `cart_id` and `shop_admin`. `shop.go:35`, `shop.go:63`, `shop.go:146`, `shop.go:199`
- Shop proxy routes are `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*`, answered before the pages' mux. `shop.go:112`, `shop.go:130`
- Shop proxy refuses a path with a `.` or `..` segment, once decoded, with 400. `shop.go:139`, `shop.go:166`
- Shop proxy methods are `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`; any other answers 405 with `Allow`. `shop.go:65`, `shop.go:171`
- Shop proxy refuses a body over 4 MiB with 413: by its `Content-Length`, or once read past it (`http.MaxBytesReader`). `shop.go:68`, `shop.go:177`, `shop.go:205`, `shop.go:236`
- Shop `x-droplet-location` is the `SHOP_PUBLIC_URL` origin, never the request's Host. `shop.go:192`
- Shop proxy URL is concatenated, not resolved: `//elsewhere` stays a path on the shop. `shop.go:183`
- Shop proxy answers 502 `The shop is unreachable.` when the shop is down. `shop.go:209`
- Shop proxy drops the per-hop headers, `Content-Encoding` and `Content-Length`, and whatever `Connection` names; every `Set-Cookie` goes back. `shop.go:48`, `shop.go:218`, `shop.go:224`
- Shop proxy streams the request body and the answer, and sends no body for `HEAD`. `shop.go:228`, `shop.go:229`
- Shop fragment fetch sends `accept: text/html`, `x-droplet-location`, the page as `referer` and the browser's `cookie` cut down to the shop's, timeout 10 s. `shop.go:292`, `shop.go:298`, `shop.go:300`, `shop.go:302`
- Shop fragment 3xx keeps its `location`. `shop.go:312`
- Shop fragment inserted only when 2xx or 500 and `text/html`, as `template.HTML`. `shop.go:324`, `main.go:140`
- Shop fragment otherwise renders `<p class="shop-unavailable">` with the id escaped. `shop.go:283`
- Shop pages fetch every fragment at once, a goroutine each. `shop.go:332`
- Shop product lookup reads `/droplets/product-page/_data?slug=`, timeout 5 s, and needs string `id` and `name`. `shop.go:353`, `shop.go:356`, `shop.go:381`
- Shop `Link` preloads kept only for `preload`/`modulepreload` on the public origin. `shop.go:421`, `shop.go:425`
- Shop pages always fetch `toast-center` and `shopping-cart` with `variant=badge`. `shop.go:483`
- Shop page redirect: the first fragment with a `location` answers the page with its status. `shop.go:494`
- Shop pages answer `cache-control: private, no-store` and every fragment's `Set-Cookie`. `shop.go:486`
- Shop stylesheet `/shop.css` is served from the embedded `static/shop.css`. `shop.go:511`
- Shop page routes are `GET` (and `HEAD`) only; another method answers 405. `shop.go:123`, `shop.go:127`
- Gallery passes the whole query to `product-filter` and `product-library`. `shop.go:518`
- Product page answers 404 when the product is not found. `shop.go:524`
- Product page comments props are `order`, `page`, `showing` plus `productId`. `shop.go:527`
- Product page props are `slug` plus `v` (when the link had one). `shop.go:530`
- Login page passes `next`. `shop.go:536`
- Admin page passes `view` and `id`. `shop.go:541`
- Shop layout loads `/shop.css` and `/index.js` from this origin. `templates/shop/layout.html:8`, `templates/shop/layout.html:13`
- Shop layout speculation rules prefetch `/product/*`, eagerness `moderate`. `templates/shop/layout.html:12`
- Shop layout puts the toasts fragment first in the body. `templates/shop/layout.html:16`
- Unit tests run against a stand-in shop (`httptest`), in the image's build. `shop_test.go:19`, `Dockerfile:9`
- Typecheck: no `package.json`, so `pnpm typecheck:hosts` does not cover this host. `../../../tests/hosts/typecheck.mjs:20`
- Host test URL is `http://localhost:8017`; `pnpm test:hosts go` runs the shop flow. `../hosts.json`
- Host test checks a new visitor gets nobody else's cart or session. `../../../tests/hosts/e2e/shop.spec.ts:288`

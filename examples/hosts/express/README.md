# Node (Express)

Two ways to combine Express 5 with droplets. `src/server.js` is Express as a
host: the droplets server runs as its own process and Express fetches
fragments from it, as every non-Node host does. It also runs the
[shop demo](../../shop) through a same-origin proxy. `src/embedded.js` mounts
a built droplets server inside Express, in one process.

```bash
docker compose up --build
open http://localhost:8003          # the three Svelte droplets
open http://localhost:8003/gallery  # the shop (demo login: admin / droplets)
```

Set `SHOP_SECRET` and `DROPLETS_SECRET` first (32 or more random characters
each, `openssl rand -hex 32`), in the environment or a `.env` file beside
`docker-compose.yml`: compose refuses to start without them. `pnpm test:hosts`
generates its own for a run.

Compose starts three services: `droplets` (the Svelte example, published on
http://localhost:8000), `shop` (reached only by the host) and `web` (this
app, on http://localhost:8003). Every port is published on `127.0.0.1`.

## Details

### 1. Express as a host (`src/server.js`)

`/` asks the droplets server for `client`, `ssr-hydrate` and
`ssr-nohydrate` with the `who` query (default `Express`).
`src/droplets.js` fetches `GET /droplets/<id>` from `DROPLETS_INTERNAL_URL`
with `x-droplet-location` set to `DROPLETS_PUBLIC_URL`, the origin the
browser loads scripts from, and writes the one `<script type="module">` for
`/index.js` on that origin. The page and the droplets server are different
origins, so the droplets server runs with `cors: true`
(`examples/frameworks/svelte/droplets.config.ts`).

### The shop demo (`src/shop.js`)

`/gallery`, `/product/<slug>`, `/login` and `/admin` embed the shop (see its
[`CONTRACT.md`](../../shop/CONTRACT.md)):

- a same-origin proxy for `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*` and
  `/api/*` (bodies streamed, `Set-Cookie` and redirects passed back
  untouched), so the cart and admin cookies are this origin's own; it
  forwards a fixed list of request headers, none that names a host;
- the pages fetch their fragments on the server with `x-droplet-location`
  (the configured `SHOP_PUBLIC_URL`, never the request's Host), the
  browser's `Cookie`, the page as `Referer` and `redirect: "manual"`; only
  an HTML answer (2xx or 500) is inserted, the fragments' `Set-Cookie` go
  out with the page, a droplet's redirect is answered as it is, and their
  `Link` preloads go into its `<head>`;
- `public/shop.css` is the layout, the same file in every host but
  WordPress.

### Over https, off localhost

The shop's cookies are `Secure` everywhere except plain HTTP to
`localhost`, so a host on another name needs https. The
`docker-compose.https.yml` override puts Caddy in front (`Caddyfile`,
`tls internal`: Caddy's own CA, no ACME) on
`https://127-0-0-1.sslip.io:8443`, a public name that resolves to
127.0.0.1, and makes that the host's `SHOP_PUBLIC_URL` and the shop's
trusted origin:

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml up --build
open https://127-0-0-1.sslip.io:8443/gallery   # accept the certificate warning
```

`pnpm test:hosts express --https` (from the repository root) runs the shop
flow there and checks that `cart_id` and `shop_admin` arrive `Secure` and
`HttpOnly`.

### 2. One process (`src/embedded.js`)

A droplets server's `vite build` writes `dist/server.js`, which exports
`{ fetch }` and does not listen when imported. `src/embedded.js` imports it,
renders its page by calling `fetch()` in-process (no HTTP hop) and mounts it
with `@hono/node-server`'s `getRequestListener` for every other route, so
droplet routes and Express routes share one origin: no CORS, no
`x-droplet-location`. The in-process requests carry `EXPRESS_SITE_URL`
(default `http://localhost:<PORT>`) as their origin, which the droplets
server takes as its location: never the client's `Host` header.
`DROPLETS_DIST`, the droplets server's build folder, has no default.

```bash
# from the repository root
pnpm build && pnpm --filter @dropletsjs/example-svelte build
cd examples/hosts/express && npm install
DROPLETS_DIST=../../frameworks/svelte/dist npm run start:embedded
open http://localhost:8003
```

### Environment

| Variable | Service | Default in compose |
|---|---|---|
| `DROPLETS_INTERNAL_URL` | web | `http://droplets:8000` |
| `DROPLETS_PUBLIC_URL` | web | `${DROPLETS_URL:-http://localhost:8000}` |
| `SHOP_INTERNAL_URL` | web | `http://shop:8300` |
| `SHOP_PUBLIC_URL` | web | `${WEB_URL:-http://localhost:8003}` |
| `DROPLETS_TRUSTED_ORIGINS` | droplets | the droplets URL and this host's URL |
| `DROPLETS_TRUSTED_ORIGINS` | shop | this host's URL |
| `DROPLETS_DIST` | `src/embedded.js` only | none: the droplets server's build folder, required |
| `EXPRESS_SITE_URL` | `src/embedded.js` only | `http://localhost:<PORT>`: the site's public origin |

`WEB_PORT`, `WEB_URL`, `DROPLETS_PORT` and `DROPLETS_URL` move the published
ports and public URLs; `tests/hosts/run.mjs` sets them for
`HOSTS_PORT_BASE`. `PORT` (default 8003) is the listen port of both scripts.

### Without Docker

With a droplets server on port 8000 and, for `/gallery`, the shop on 8300
started with `DROPLETS_TRUSTED_ORIGINS=http://localhost:8003` (see the
[shop's README](../../shop/README.md)):

```bash
npm install
npm start        # http://localhost:8003
```

### Checks

From the repository root: `pnpm typecheck:hosts express` (`npm ci`, then
`tsc --noEmit` over the JavaScript in `src/` with `checkJs`) and
`pnpm test:hosts express` (the shop flow in Chromium, against this compose
stack; `--https` for the Caddy variant). The guide's page:
[Express](https://dropletsjs.dev/integrate/hosts/express/).

## Facts

- Web service publishes `127.0.0.1:${WEB_PORT:-8003}:8003`. `docker-compose.yml:37`
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
- Web env `SHOP_PUBLIC_URL` is `${WEB_URL:-http://localhost:8003}`. `docker-compose.yml:42`
- Https override sets the shop's `DROPLETS_TRUSTED_ORIGINS` to `https://127-0-0-1.sslip.io:8443`. `docker-compose.https.yml:11`
- Https override sets the web `SHOP_PUBLIC_URL` to `https://127-0-0-1.sslip.io:8443`. `docker-compose.https.yml:15`
- Https override adds a `caddy` service from `caddy:2-alpine` with the `Caddyfile` baked in. `docker-compose.https.yml:22`, `docker-compose.https.yml:23`
- Https override publishes Caddy on `127.0.0.1:8443`. `docker-compose.https.yml:25`
- Caddyfile disables the http-to-https redirects. `Caddyfile:6`
- Caddyfile serves `127-0-0-1.sslip.io:8443` with `tls internal` (Caddy's own CA). `Caddyfile:9`, `Caddyfile:10`
- Caddyfile proxies to `web:8003`. `Caddyfile:11`
- Dockerfile builds on `node:24-alpine` with `npm ci --omit=dev`. `Dockerfile:1`, `Dockerfile:4`
- Dockerfile copies only `src` and `public`. `Dockerfile:5`, `Dockerfile:6`
- Dockerfile runs `node src/server.js` (the host pattern). `Dockerfile:8`
- Host listen port is `PORT`, default 8003. `src/server.js:9`
- Host `DROPLETS_INTERNAL_URL` and `DROPLETS_PUBLIC_URL` default to `http://localhost:8000`. `src/server.js:11`, `src/server.js:12`
- Host basic page droplets are `client`, `ssr-hydrate`, `ssr-nohydrate`. `src/server.js:16`
- Host mounts the shop router before `/`. `src/server.js:21`
- Host shop defaults: `SHOP_INTERNAL_URL` `http://localhost:8300`, `SHOP_PUBLIC_URL` `http://localhost:<PORT>`. `src/server.js:23`, `src/server.js:24`
- Host basic page `who` defaults to `Express`. `src/server.js:29`
- Host log line: `express host listening on http://localhost:<port>`. `src/server.js:45`
- Droplet client fragment fetch sends `accept: text/html` and `x-droplet-location: publicUrl`, never follows a redirect, 5 second timeout. `src/droplets.js:22`, `src/droplets.js:23`, `src/droplets.js:24`
- Droplet client pastes only a 2xx or 500 `text/html` answer; anything else renders an inline `<p class="error">`, the id and the error escaped. `src/droplets.js:28`, `src/droplets.js:32`, `src/droplets.js:34`
- Droplet client script tag loads `${publicUrl}/index.js`. `src/droplets.js:39`
- Embedded needs `DROPLETS_DIST`, the droplets server's build folder, resolved from the working directory; without it, it exits 2. `src/embedded.js:18`, `src/embedded.js:22`
- Embedded imports `dist/server.js` and uses its default export `{ fetch }`. `src/embedded.js:32`
- Embedded fragment URLs are on `EXPRESS_SITE_URL` (default `http://localhost:<PORT>`), never the client's Host. `src/embedded.js:29`, `src/embedded.js:43`
- Embedded renders fragments by calling `droplets.fetch()` in-process. `src/embedded.js:45`
- Embedded page loads `/index.js` from its own origin. `src/embedded.js:53`
- Embedded mounts every other route on the droplets handler via `getRequestListener`. `src/embedded.js:59`
- Embedded log line: `express + droplets listening on http://localhost:<port>`. `src/embedded.js:62`
- Shop footer stack name is `Express 5`. `src/shop.js:16`
- Shop proxy forwards only `accept`, `accept-language`, `content-type`, `if-none-match`, `origin`, `referer`, `user-agent`, `x-droplet-props`, `x-droplets-build`, plus `cookie` cut down to `cart_id` and `shop_admin` (`SHOP_COOKIES`). `src/shop.js:19`, `src/shop.js:44`, `src/shop.js:97`
- Shop proxy refuses a path with a `.` or `..` segment, once decoded, with 400. `src/shop.js:56`, `src/shop.js:91`
- Shop upstream timeouts: the proxy 15 s, a fragment 10 s, the product lookup 5 s. `src/shop.js:108`, `src/shop.js:147`, `src/shop.js:175`
- Shop proxy drops `connection`, `content-encoding`, `content-length`, `keep-alive`, `transfer-encoding` from the answer and re-sets `set-cookie`. `src/shop.js:32`, `src/shop.js:116`
- Shop proxy routes are `/index.js`, `/env.js`, `/index.css`, `/droplets`, `/assets`, `/api`, every method. `src/shop.js:41`, `src/shop.js:125`
- Shop `x-droplet-location` is the origin of `SHOP_PUBLIC_URL`, never the request's Host. `src/shop.js:85`, `src/shop.js:92`
- Shop proxy URL is concatenated with `req.originalUrl`, not resolved: `//elsewhere` stays a path on the shop. `src/shop.js:102`
- Shop proxy streams the request body and never follows redirects. `src/shop.js:105`, `src/shop.js:107`
- Shop proxy sends no body for `HEAD` or an empty upstream body. `src/shop.js:117`
- Shop proxy answers 502 `The shop is unreachable.` when the shop is down. `src/shop.js:121`
- Shop fragment fetch sends `accept: text/html`, `x-droplet-location`, the page as `referer` and the browser's `cookie` cut down to the shop's. `src/shop.js:132`, `src/shop.js:133`
- Shop fragment fetch uses `redirect: "manual"`; a 3xx keeps its `location`. `src/shop.js:147`, `src/shop.js:152`
- Shop fragment inserted only when 2xx or 500 and `text/html`. `src/shop.js:154`, `src/shop.js:155`
- Shop fragment otherwise renders `<p class="shop-unavailable">` with the id escaped. `src/shop.js:164`
- Shop product lookup reads `/droplets/product-page/_data?slug=` and needs string `id` and `name`. `src/shop.js:170`, `src/shop.js:180`
- Shop `Link` preloads kept only for `preload`/`modulepreload` on the public origin. `src/shop.js:199`, `src/shop.js:206`
- Shop layout speculation rules prefetch `/product/*`, eagerness `moderate`. `src/shop.js:231`
- Shop layout loads `/shop.css` and `/index.js` from this origin. `src/shop.js:229`, `src/shop.js:232`
- Shop pages always fetch `toast-center` and `shopping-cart` with `variant=badge`. `src/shop.js:262`, `src/shop.js:263`
- Shop pages answer `cache-control: private, no-store` and every fragment's `Set-Cookie`. `src/shop.js:267`, `src/shop.js:268`
- Shop page redirect: the first fragment with a `location` answers the page with its status. `src/shop.js:269`, `src/shop.js:270`
- Shop stylesheet `/shop.css` is served from `public/`. `src/shop.js:281`
- Gallery passes the whole query to `product-filter` and `product-library`. `src/shop.js:290`, `src/shop.js:291`
- Product page answers 404 when the product is not found. `src/shop.js:310`
- Product page comments props are `order`, `page`, `showing` plus `productId`. `src/shop.js:315`, `src/shop.js:316`
- Product page props are `v` (when the link had one) plus `slug`. `src/shop.js:319`, `src/shop.js:320`
- Login page passes `next`. `src/shop.js:343`
- Admin page passes `view` and `id`. `src/shop.js:352`
- Scripts: `start` runs `src/server.js`, `start:embedded` runs `src/embedded.js`. `package.json:7`, `package.json:8`
- Typecheck script is `tsc --noEmit`. `package.json:9`
- Dependencies are `express` ^5.1.0 and `@hono/node-server` ^2.1.6 (for `embedded.js`); no `@dropletsjs/*` package. `package.json:12`, `package.json:13`
- Tsconfig checks the JavaScript in `src` (`allowJs`, `checkJs`, `strict`). `tsconfig.json:6`, `tsconfig.json:7`, `tsconfig.json:9`, `tsconfig.json:14`
- Typecheck run by `pnpm typecheck:hosts`: `npm ci`, then `npm run typecheck`. `../../../tests/hosts/typecheck.mjs:47`, `../../../tests/hosts/typecheck.mjs:48`
- Host test URL is `http://localhost:8003`; `pnpm test:hosts express` runs the shop flow. `../../../tests/hosts/run.mjs:58`
- Host test `--https` runs on `https://127-0-0-1.sslip.io:8443`, express only. `../../../tests/hosts/run.mjs:79`
- Host test checks the cart and admin cookies are `HttpOnly`, and `Secure` exactly when the URL is https. `../../../tests/hosts/e2e/shop.spec.ts:35`, `../../../tests/hosts/e2e/shop.spec.ts:36`, `../../../tests/hosts/e2e/shop.spec.ts:129`, `../../../tests/hosts/e2e/shop.spec.ts:130`

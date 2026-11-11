# Astro

An Astro 5 site (`output: "server"`) that embeds droplets. Each page fetches
its fragments in its frontmatter, on the server and per request, and renders
them with `<Fragment set:html>`. `/` shows the Svelte example's three
droplets; `/gallery`, `/product/<slug>`, `/login` and `/admin` run the
[shop demo](../../shop) through a same-origin proxy.

```bash
docker compose up --build
open http://localhost:8005          # the three Svelte droplets
open http://localhost:8005/gallery  # the shop (demo login: admin / droplets)
```

Compose starts three services: `droplets` (the Svelte example, published on
http://localhost:8000), `shop` (reached only by the host) and `web` (this
site, on http://localhost:8005). Every port is published on `127.0.0.1`.

## Details

### The basic page (`/`)

`src/pages/index.astro` asks the droplets server for `client`,
`ssr-hydrate` and `ssr-nohydrate` with the `who` query (default `Astro`)
and loads `/index.js` once from `DROPLETS_PUBLIC_URL`, marked `is:inline` so
Astro leaves the external module alone. `src/lib/droplets.ts` fetches from
`DROPLETS_INTERNAL_URL` and sends `DROPLETS_PUBLIC_URL` as
`x-droplet-location`, so the fragments point the browser at the public
origin. The page and the droplets server are different origins, so the
droplets server runs with `cors: true`
(`examples/frameworks/svelte/droplets.config.ts`).

### The shop demo

- `src/pages/index.js.ts` and `src/pages/{droplets,assets,api}/[...path].ts`
  proxy the shop's routes under this origin (`ALL` methods, bodies
  streamed), so the cart and admin cookies are this origin's own.
- The proxy forwards a fixed list of request headers (none that names a
  host), sends `x-droplet-location` set to `SHOP_PUBLIC_URL`, never the
  request's Host, and passes `Set-Cookie` and redirects back untouched.
- Each page's frontmatter (`src/lib/shop-page.ts`) fetches the toasts, the
  cart badge and its own fragments with the browser's `Cookie`, the page as
  `Referer` and `redirect: "manual"`. Only an HTML answer (2xx or 500) is
  inserted. The fragments' `Set-Cookie` go out with the page, a droplet's
  redirect is answered as it is, and `src/layouts/Shop.astro` writes their
  `Link` preloads into the head.
- `src/lib/shop.ts` is the framework-free part (Request in, Response or HTML
  out). `public/shop.css` is the layout, the same file in every host but
  WordPress.
- The contract the pages follow is [`CONTRACT.md`](../../shop/CONTRACT.md).

### Cross-site form check

Astro's own check (`security.checkOrigin`) trusts the request's host only
when `security.allowedDomains` lists it, and that list is fixed at build.
`astro.config.mjs` turns it off and `src/middleware.ts` runs the same check
against `SHOP_PUBLIC_URL`, read at runtime: a form-like `POST` (or one
without a content type) from another origin gets a 403. One image runs under
any origin. The shop checks `Origin` again on its side
(`DROPLETS_TRUSTED_ORIGINS`).

### Environment

| Variable | Service | Default in compose |
|---|---|---|
| `DROPLETS_INTERNAL_URL` | web | `http://droplets:8000` |
| `DROPLETS_PUBLIC_URL` | web | `${DROPLETS_URL:-http://localhost:8000}` |
| `SHOP_INTERNAL_URL` | web | `http://shop:8300` |
| `SHOP_PUBLIC_URL` | web | `${WEB_URL:-http://localhost:8005}` |
| `DROPLETS_TRUSTED_ORIGINS` | droplets | the droplets URL and this host's URL |
| `DROPLETS_TRUSTED_ORIGINS` | shop | this host's URL |

`WEB_PORT`, `WEB_URL`, `DROPLETS_PORT` and `DROPLETS_URL` move the published
ports and public URLs; `tests/hosts/run.mjs` sets them for
`HOSTS_PORT_BASE`.

### Without Docker

With a droplets server on port 8000 (and the shop on 8300, started with
`DROPLETS_TRUSTED_ORIGINS=http://localhost:8005`, for `/gallery`; see the
[shop's README](../../shop/README.md)):

```bash
npm install
npm run dev      # http://localhost:8005
```

### Checks

From the repository root: `pnpm typecheck:hosts astro` (`npm ci`, then
`astro check`) and `pnpm test:hosts astro` (the shop flow in Chromium,
against this compose stack). The guide's page:
[Astro](https://dropletsjs.dev/integrate/hosts/astro/).

## Facts

- Web service publishes `127.0.0.1:${WEB_PORT:-8005}:8005`. `docker-compose.yml:37`
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
- Web env `SHOP_PUBLIC_URL` is `${WEB_URL:-http://localhost:8005}`. `docker-compose.yml:42`
- Dockerfile builds on `node:24-alpine` and prunes dev dependencies after `npm run build`. `Dockerfile:1`, `Dockerfile:6`
- Dockerfile sets `HOST=0.0.0.0` and `PORT=8005`. `Dockerfile:10`, `Dockerfile:11`
- Dockerfile runs `node ./dist/server/entry.mjs`. `Dockerfile:16`
- Astro config `output` is `server`: pages render per request. `astro.config.mjs:6`
- Astro adapter is `@astrojs/node` in `standalone` mode. `astro.config.mjs:7`
- Astro server port is 8005. `astro.config.mjs:8`
- Astro `security.checkOrigin` is off; `src/middleware.ts` replaces it. `astro.config.mjs:14`
- Middleware origin comes from `SHOP_PUBLIC_URL` at runtime, default `http://localhost:8005`. `src/middleware.ts:11`
- Middleware skips prerendered pages and `GET`, `HEAD`, `OPTIONS`. `src/middleware.ts:13`, `src/middleware.ts:18`
- Middleware form-like types are `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`. `src/middleware.ts:14`
- Middleware treats a request without a content type as form-like. `src/middleware.ts:21`
- Middleware answers 403 to a form-like request whose `Origin` is not the public origin. `src/middleware.ts:22`, `src/middleware.ts:23`
- Basic page `DROPLETS_INTERNAL_URL` defaults to `http://localhost:8000`. `src/lib/droplets.ts:2`
- Basic page `DROPLETS_PUBLIC_URL` defaults to `http://localhost:8000`. `src/lib/droplets.ts:5`
- Basic page fragment fetch sends `x-droplet-location: DROPLETS_PUBLIC_URL`. `src/lib/droplets.ts:16`
- Basic page fragment failure renders an inline `<p class="error">`. `src/lib/droplets.ts:17`, `src/lib/droplets.ts:20`
- Basic page droplets are `client`, `ssr-hydrate`, `ssr-nohydrate`. `src/pages/index.astro:6`
- Basic page `who` defaults to `Astro`. `src/pages/index.astro:4`
- Basic page loads `${DROPLETS_PUBLIC_URL}/index.js` with `is:inline`. `src/pages/index.astro:16`
- Shop proxy routes are `/index.js`, `/droplets/*`, `/assets/*`, `/api/*`, all methods (`ALL`). `src/pages/index.js.ts:5`, `src/pages/droplets/[...path].ts:5`, `src/pages/assets/[...path].ts:5`, `src/pages/api/[...path].ts:5`
- Shop proxy forwards only `accept`, `accept-language`, `content-type`, `cookie`, `if-none-match`, `origin`, `referer`, `user-agent`, `x-droplet-props`, `x-droplets-build`. `src/lib/shop.ts:48`
- Shop proxy drops `connection`, `content-encoding`, `content-length`, `keep-alive`, `transfer-encoding` from the answer and re-appends `set-cookie`. `src/lib/shop.ts:62`, `src/lib/shop.ts:117`
- Shop `x-droplet-location` is the origin of `SHOP_PUBLIC_URL`, never the request's Host. `src/lib/shop.ts:91`, `src/lib/shop.ts:96`
- Shop proxy URL is concatenated, not resolved: `//elsewhere` stays a path on the shop. `src/lib/shop.ts:104`
- Shop proxy streams the request body (`duplex: "half"`) and never follows redirects. `src/lib/shop.ts:108`, `src/lib/shop.ts:110`
- Shop proxy sends no body for `HEAD` and statuses 101, 204, 205, 304. `src/lib/shop.ts:72`, `src/lib/shop.ts:118`
- Shop proxy answers 502 `The shop is unreachable.` when the shop is down. `src/lib/shop.ts:122`
- Shop fragment fetch sends `accept: text/html`, `x-droplet-location`, the page as `referer` and the browser's `cookie`. `src/lib/shop.ts:134`, `src/lib/shop.ts:135`
- Shop fragment fetch uses `redirect: "manual"` and `cache: "no-store"`; a 3xx keeps its `location`. `src/lib/shop.ts:138`, `src/lib/shop.ts:143`
- Shop fragment inserted only when 2xx or 500 and `text/html`. `src/lib/shop.ts:145`, `src/lib/shop.ts:146`
- Shop fragment otherwise renders `<p class="shop-unavailable">` with the id escaped. `src/lib/shop.ts:156`
- Shop product lookup reads `/droplets/product-page/_data?slug=` and needs string `id`, `name`, `slug`. `src/lib/shop.ts:162`, `src/lib/shop.ts:172`
- Shop `Link` preloads kept only for `preload`/`modulepreload` on the public origin. `src/lib/shop.ts:197`, `src/lib/shop.ts:204`
- Shop `PROXIED` regex is exported but no route uses it. `src/lib/shop.ts:74`
- Shop footer stack name is `Astro 5`. `src/lib/shop-page.ts:4`
- Shop defaults: `SHOP_INTERNAL_URL` `http://localhost:8300`, `SHOP_PUBLIC_URL` `http://localhost:8005`. `src/lib/shop-page.ts:7`, `src/lib/shop-page.ts:8`
- Shop pages always fetch `toast-center` and `shopping-cart` with `variant=badge`. `src/lib/shop-page.ts:21`, `src/lib/shop-page.ts:22`
- Shop page redirect: the first fragment with a `location` answers the page, with its status and every `Set-Cookie`. `src/lib/shop-page.ts:32`, `src/lib/shop-page.ts:44`
- Shop pages answer `cache-control: private, no-store`. `src/lib/shop-page.ts:42`, `src/lib/shop-page.ts:46`
- Gallery passes the whole query to `product-filter` and `product-library`. `src/pages/gallery.astro:8`, `src/pages/gallery.astro:9`
- Product page comments props are `order`, `page`, `showing` plus `productId`. `src/pages/product/[slug].astro:7`, `src/pages/product/[slug].astro:8`
- Product page props are `v` (when the link had one) plus `slug`. `src/pages/product/[slug].astro:11`, `src/pages/product/[slug].astro:12`
- Product page answers 404 when the product is not found. `src/pages/product/[slug].astro:24`
- Login page passes `next`. `src/pages/login.astro:6`
- Admin page passes `view` and `id`. `src/pages/admin.astro:7`
- Shop layout loads `/shop.css` and `/index.js` (`is:inline`) from this origin. `src/layouts/Shop.astro:33`, `src/layouts/Shop.astro:36`
- Shop layout speculation rules prefetch `/product/*`, eagerness `moderate`. `src/layouts/Shop.astro:23`
- Shop layout puts the toasts fragment first in the body. `src/layouts/Shop.astro:39`
- Dev script runs `astro dev --port 8005`. `package.json:7`
- Typecheck script is `astro check`. `package.json:10`
- Dependencies are `astro` ^5 and `@astrojs/node` ^9; no `@dropletsjs/*` package. `package.json:13`, `package.json:14`
- Typecheck run by `pnpm typecheck:hosts`: `npm ci`, then `npm run typecheck`. `../../../tests/hosts/typecheck.mjs:47`, `../../../tests/hosts/typecheck.mjs:48`
- Host test URL is `http://localhost:8005`; `pnpm test:hosts astro` runs the shop flow. `../../../tests/hosts/run.mjs:65`

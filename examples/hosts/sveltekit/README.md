# SvelteKit

A SvelteKit app that embeds droplets from a separate droplets server. The
droplets are Svelte components too, but this example treats the droplets
server as what it is from the outside: a remote service. `+page.server.ts`
fetches each droplet's HTML, the page renders it with `{@html}`, and
`<svelte:head>` loads `/index.js` once. The same app hosts the
[shop example](../../shop) at `/gallery`.

```bash
docker compose up --build
open http://localhost:8006          # the basic page: three Svelte droplets
open http://localhost:8006/gallery  # the shop (demo login: admin / droplets)
```

| Service | Port | What it is |
|---|---|---|
| `web` | 8006 | this SvelteKit app (adapter-node) |
| `droplets` | 8000 | the Svelte example (`examples/frameworks/svelte`) as a droplets server |
| `shop` | 8300, compose network only | the shop example, reached through `web` |

## Details

### The basic page (`src/routes/+page.server.ts`)

`load` fetches `GET /droplets/<id>?who=<who>` for `client`, `ssr-hydrate` and
`ssr-nohydrate` through `src/lib/droplets.server.ts`, with
`x-droplet-location` set to `DROPLETS_PUBLIC_URL`. `?who=Kit` changes the
prop. A droplet that fails renders an inline `<p class="error">`.

The page and the droplets server are different origins, so the droplets
server runs with `cors: true` and lists this host's origin in
`DROPLETS_TRUSTED_ORIGINS`.

Without Docker, with a droplets server already running on port 8000:

```bash
npm install
npm run dev        # vite dev on http://localhost:8006
```

| Variable | Default | What it is |
|---|---|---|
| `DROPLETS_INTERNAL_URL` | `http://localhost:8000` | where the server fetches fragments |
| `DROPLETS_PUBLIC_URL` | `http://localhost:8000` | the browser-facing droplets origin: `x-droplet-location` and the `/index.js` URL |
| `SHOP_INTERNAL_URL` | `http://localhost:8300` | where the server reaches the shop |
| `SHOP_PUBLIC_URL` | `http://localhost:8006` | this host's public origin, sent to the shop as `x-droplet-location` |
| `ORIGIN` | none | adapter-node's own origin; SvelteKit checks form posts against it |
| `BODY_SIZE_LIMIT` | `4M` in the image | above adapter-node's 512 KB default, for the shop's admin image uploads |

### The shop (the `(shop)` route group)

`/gallery`, `/product/[slug]`, `/login` and `/admin` embed the shop and follow
its [`CONTRACT.md`](../../shop/CONTRACT.md).

- `src/hooks.server.ts` proxies `/index.js`, `/droplets/*`, `/assets/*` and
  `/api/*` to the shop before routing, bodies streamed, so its cookies are
  this origin's own.
- `src/lib/shop.server.ts` is the framework-free part (Request in, Response
  or HTML out): the proxy, fragment fetches, the product lookup and the
  `Link` preloads. `x-droplet-location` is the origin of `SHOP_PUBLIC_URL`,
  never the request's Host.
- `src/lib/shop-page.server.ts` fetches a page's fragments in parallel with
  the browser's `Cookie` and the page URL as `Referer`. Their `Set-Cookie`
  goes to `event.locals.shopCookies`, which `handle` appends to the response
  untouched; a droplet's redirect is answered with its status.
- `(shop)/+layout.server.ts` fetches `toast-center` and the cart badge
  (`shopping-cart`, `variant=badge`) on every shop page; the layout puts the
  preloads into `<svelte:head>` and loads `/shop.css` and `/index.js`.
- Shop links reload the page (`data-sveltekit-reload`), as on every other
  host. `static/shop.css` is the same file as the other hosts' copy.

The compose file sets `ORIGIN` and `BODY_SIZE_LIMIT`; the Dockerfile sets
`BODY_SIZE_LIMIT` only. Outside Docker, start the shop
(`pnpm --filter @dropletsjs/example-shop build`, then `pnpm start` in
`examples/shop` with `DROPLETS_TRUSTED_ORIGINS=http://localhost:8006`), then:

```bash
npm run build
ORIGIN=http://localhost:8006 BODY_SIZE_LIMIT=4M PORT=8006 node build
open http://localhost:8006/gallery
```

### Checks

From the repository root:

- `pnpm typecheck:hosts sveltekit` runs `npm ci` and `npm run typecheck`
  (`svelte-kit sync && svelte-check --fail-on-warnings`) here. No Docker.
- `pnpm test:hosts sveltekit` starts this compose stack, runs the shop flow
  (`tests/hosts/e2e/shop.spec.ts`) against http://localhost:8006 and takes
  the stack down. It needs Docker.

## Facts

- `npm run dev` runs `vite dev --port 8006`. `package.json:7`
- `npm start` runs `node build`, adapter-node's output. `package.json:9`, `svelte.config.js:4`
- `npm run typecheck` runs `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --fail-on-warnings`. `package.json:10`
- Dependencies are `@sveltejs/adapter-node`, `@sveltejs/kit`, `@sveltejs/vite-plugin-svelte`, `svelte`, `svelte-check`, `typescript`, `vite`; no `@dropletsjs/*` package. `package.json:12`
- `tsconfig.json` extends `.svelte-kit/tsconfig.json`, written by `svelte-kit sync`. `tsconfig.json:3`
- `DROPLETS_INTERNAL_URL` defaults to `http://localhost:8000`. `src/lib/droplets.server.ts:4`
- `DROPLETS_PUBLIC_URL` defaults to `http://localhost:8000`. `src/lib/droplets.server.ts:6`
- Basic page fragment fetch sends `x-droplet-location: DROPLETS_PUBLIC_URL`. `src/lib/droplets.server.ts:17`
- Basic page fragment that is not ok or fails renders `<p class="error">`. `src/lib/droplets.server.ts:18`, `src/lib/droplets.server.ts:21`
- Basic page droplets are `client`, `ssr-hydrate` and `ssr-nohydrate`. `src/routes/+page.server.ts:5`
- Basic page prop `who` comes from the query, default `SvelteKit`. `src/routes/+page.server.ts:8`
- Basic page loads `<DROPLETS_PUBLIC_URL>/index.js` in `<svelte:head>`. `src/routes/+page.svelte:8`
- Basic page renders each fragment with `{@html}`. `src/routes/+page.svelte:19`
- Body attributes come from `handle`, through the `%host.body%` placeholder in `app.html`. `src/app.html:9`, `src/hooks.server.ts:15`
- Shop proxy runs in `handle` before routing for paths matching `PROXIED`. `src/hooks.server.ts:11`
- Shop proxy paths: `/index.js`, `/droplets/*`, `/assets/*`, `/api/*`. `src/lib/shop.server.ts:74`
- Shop pages are routes under `/(shop)`. `src/hooks.server.ts:13`
- Shop page sets `cache-control: private, no-store`. `src/hooks.server.ts:19`
- Shop page appends the fragments' `Set-Cookie` from `locals.shopCookies` untouched, never through `cookies.set`. `src/hooks.server.ts:22`, `src/app.d.ts:5`
- `SHOP_INTERNAL_URL` defaults to `http://localhost:8300`. `src/lib/shop-page.server.ts:9`
- `SHOP_PUBLIC_URL` defaults to `http://localhost:8006`. `src/lib/shop-page.server.ts:10`
- `SHOP_PUBLIC_URL` is reduced to its origin, the `x-droplet-location` value. `src/lib/shop.server.ts:91`
- Shop proxy sends `x-droplet-location` set to that origin, never the request's Host. `src/lib/shop.server.ts:96`
- Shop proxy forwards only `accept`, `accept-language`, `content-type`, `cookie`, `if-none-match`, `origin`, `referer`, `user-agent`, `x-droplet-props`, `x-droplets-build`. `src/lib/shop.server.ts:48`
- Shop proxy drops hop-by-hop response headers and passes `Set-Cookie` untouched. `src/lib/shop.server.ts:62`, `src/lib/shop.server.ts:117`
- Shop proxy concatenates the path onto the shop's base, never resolves it. `src/lib/shop.server.ts:104`
- Shop proxy never follows redirects and streams the request body (`duplex: "half"`). `src/lib/shop.server.ts:108`, `src/lib/shop.server.ts:110`
- Shop proxy answers 502 `The shop is unreachable.` when the shop fails. `src/lib/shop.server.ts:122`
- Shop fragment fetch sends `accept: text/html`, `x-droplet-location`, the page URL as `referer` and the browser's `cookie`. `src/lib/shop.server.ts:134`, `src/lib/shop.server.ts:135`
- Shop fragment fetch uses `redirect: "manual"` and `cache: "no-store"`. `src/lib/shop.server.ts:138`
- Shop fragment 3xx is kept as a redirect; only 2xx or 500 with `text/html` is inserted. `src/lib/shop.server.ts:142`, `src/lib/shop.server.ts:145`
- Shop fragment otherwise renders `<p class="shop-unavailable">`. `src/lib/shop.server.ts:156`
- Shop product lookup reads `/droplets/product-page/_data?slug=<slug>`. `src/lib/shop.server.ts:162`
- Shop `Link` preloads keep only `preload` and `modulepreload` on this host's origin. `src/lib/shop.server.ts:197`, `src/lib/shop.server.ts:204`
- Shop fragments of one load are fetched in parallel. `src/lib/shop-page.server.ts:22`
- Shop page answers a fragment's redirect with its status (`redirect()`). `src/lib/shop-page.server.ts:25`
- Shop footer stack name is `SvelteKit 2`. `src/lib/shop-page.server.ts:6`
- Shop layout fetches `toast-center` and `shopping-cart` (`variant=badge`). `src/routes/(shop)/+layout.server.ts:9`, `src/routes/(shop)/+layout.server.ts:10`
- Shop layout loads `/shop.css`, the preloads and `/index.js`. `src/routes/(shop)/+layout.svelte:18`, `src/routes/(shop)/+layout.svelte:23`
- Shop links reload the page: the layout wraps them in `data-sveltekit-reload`. `src/routes/(shop)/+layout.svelte:27`
- Shop gallery passes the whole query to `product-filter` and `product-library`. `src/routes/(shop)/gallery/+page.server.ts:6`
- Shop product page answers 404 for an unknown slug. `src/routes/(shop)/product/[slug]/+page.server.ts:8`
- Shop product comments props: `order`, `page`, `showing` from the query, plus `productId`. `src/routes/(shop)/product/[slug]/+page.server.ts:10`
- Shop product page props: `slug`, plus `v` from the query. `src/routes/(shop)/product/[slug]/+page.server.ts:14`
- Shop login passes `next`; shop admin passes `view` and `id`. `src/routes/(shop)/login/+page.server.ts:7`, `src/routes/(shop)/admin/+page.server.ts:7`
- Docker image is `node:24-alpine`, built with `npm ci`, started with `node build`. `Dockerfile:1`, `Dockerfile:4`, `Dockerfile:17`
- Docker image sets `HOST=0.0.0.0`, `PORT=8006`, `BODY_SIZE_LIMIT=4M`; it does not set `ORIGIN`. `Dockerfile:10`, `Dockerfile:11`, `Dockerfile:13`
- Web `ORIGIN` is `WEB_URL`, default `http://localhost:8006`. `docker-compose.yml:45`
- Web `BODY_SIZE_LIMIT` is `4M`. `docker-compose.yml:48`
- Web `SHOP_PUBLIC_URL` is `WEB_URL`. `docker-compose.yml:42`
- Droplets server image is `examples/frameworks/Dockerfile`, the Svelte example by default. `docker-compose.yml:9`, `../../frameworks/Dockerfile:24`
- Droplets server CORS: the Svelte example sets `cors: true`. `../../frameworks/svelte/droplets.config.ts:16`
- Droplets server `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and `WEB_URL` (this host). `docker-compose.yml:14`
- Shop `DROPLETS_TRUSTED_ORIGINS` is `WEB_URL`, this host's public origin. `docker-compose.yml:32`
- Shop service is exposed on 8300 inside the compose network only. `docker-compose.yml:22`
- Shop demo login is `admin` / `droplets`. `docker-compose.yml:26`, `docker-compose.yml:27`
- Published ports bind `127.0.0.1`: droplets `DROPLETS_PORT` (8000), web `WEB_PORT` (8006). `docker-compose.yml:11`, `docker-compose.yml:37`
- `pnpm typecheck:hosts` covers this host: it has a `typecheck` script. `../../../tests/hosts/typecheck.mjs:21`, `package.json:10`
- `pnpm test:hosts sveltekit` expects this host on `http://localhost:8006`. `../../../tests/hosts/run.mjs:66`
- `pnpm test:hosts` runs `shop.spec.ts` for this host; the other specs skip themselves. `../../../tests/hosts/run.mjs:265`
- Host is outside the pnpm workspace: `examples/hosts/*` is not listed. `../../../pnpm-workspace.yaml:5`

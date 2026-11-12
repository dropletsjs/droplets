# Next.js (App Router)

Droplets embedded in a Next.js 16 app with server components. `/` renders
the Svelte example's three droplets on the server; `/gallery`,
`/product/<slug>`, `/login` and `/admin` embed the
[shop demo](../../shop), proxied under this app's own origin.

```bash
docker compose up --build
open http://localhost:8007            # the basic page
open http://localhost:8007/gallery    # the shop (admin / droplets on /login)
```

The compose file starts three services: the Svelte example's droplets
server on `http://localhost:8000`, the shop (reached only by this app) and
the app on `http://localhost:8007`. Both published ports listen on
`127.0.0.1` only.

Without Docker, with a droplets server already running on port 8000 (and
the shop on 8300 for the shop pages):

```bash
npm install
npm run dev
```

## Details

### The basic page (`app/(basic)/`)

`page.tsx` is a server component. It fetches `GET /droplets/<id>` for
`client`, `ssr-hydrate` and `ssr-nohydrate` (`lib/droplets.ts`) with
`cache: "no-store"`, since fragments are per-request content, and emits
them with `dangerouslySetInnerHTML`. Its root layout loads
`<DROPLETS_PUBLIC_URL>/index.js` once. `?who=` is passed to every droplet.

The page and the droplets server are different origins: the browser loads
each droplet's JavaScript from `http://localhost:8000`, so that server runs
with `cors: true`.

### The shop demo (`app/(shop)/`)

The `(shop)` route group has its own root layout. It follows the shop's
`CONTRACT.md`:

- Route handlers (`app/index.js`, `app/env.js`, `app/index.css`,
  `app/droplets/[[...path]]`, `app/assets/[...path]`, `app/api/[...path]`)
  proxy the shop's routes
  under this origin, bodies streamed, so its cookies are first-party and
  nothing is cross-origin.
- Every request to the shop carries a fixed `x-droplet-location`: the
  origin of `SHOP_PUBLIC_URL`, never the request's Host.
- The proxy passes on an allowlist of the browser's headers, and answers
  with the shop's status, headers (less the per-hop ones) and every
  `Set-Cookie` untouched. Redirects are not followed.
- The pages are server components. They fetch their fragments with the
  browser's `Cookie` and the page's URL as `Referer` (`lib/shop-page.tsx`),
  and render the fragments' `Link` preloads as `<link>` elements, which
  React puts in the head.
- Only an HTML answer (2xx, or a 500 carrying the droplet's error page) is
  inserted; anything else becomes a fixed "unavailable" note, since it may
  echo the props.
- `lib/shop.ts` is the framework-free part (Request in, Response or HTML
  out); `public/shop.css` is the layout, the same file in every host.

### Limits of server components

- **A fragment's `Set-Cookie` is dropped on a page render.** Next.js lets
  only Server Actions, Route Handlers and the `proxy`/middleware set
  cookies; a server component streams, so its headers may already be gone.
  `shopPage` logs a warning when a fragment sends one.
- **A droplet's redirect goes out as Next's 307**: `redirect()` takes no
  status.

Neither matters to the shop today: every cookie it sets, and its `303`s,
come from a form post or an API call, which go through the proxy (a Route
Handler) untouched. A droplet whose `load` sets a cookie on a plain `GET`
would need its page served from a Route Handler (fetch the fragments there,
return the HTML as a `Response` with their `Set-Cookie`), giving up React
for that page.

### Environment

| Variable | Default | Used for |
|---|---|---|
| `DROPLETS_INTERNAL_URL` | `http://localhost:8000` | how the server reaches the droplets server |
| `DROPLETS_PUBLIC_URL` | `http://localhost:8000` | the droplets server's browser-facing URL, sent as `x-droplet-location` |
| `SHOP_INTERNAL_URL` | `http://localhost:8300` | how the server reaches the shop |
| `SHOP_PUBLIC_URL` | `http://localhost:8007` | this app's public origin, sent to the shop as `x-droplet-location` |

`docker-compose.yml` reads `WEB_PORT`, `WEB_URL`, `DROPLETS_PORT` and
`DROPLETS_URL` (defaults 8007 and 8000) to move the published ports and
public URLs.

### Changing this example

It is outside the pnpm workspace, with its own `package-lock.json`. From
the repository root, `pnpm typecheck:hosts nextjs` runs `npm ci` and
`npm run typecheck` here, and `pnpm test:hosts nextjs` runs the shop flow
against the compose stack (needs Docker).

## Facts

- Next.js version range is `^16.0.0`, React `^19.2.0`. `package.json:12`, `package.json:13`
- Dependencies are `next`, `react`, `react-dom` and `server-only`: no package from this repository. `package.json:11`
- `npm run dev` runs `next dev --port 8007`. `package.json:6`
- `npm run typecheck` runs `next typegen && tsc --noEmit`. `package.json:9`
- Next build output is `standalone`, traced from this folder (`outputFileTracingRoot`). `next.config.ts:5`, `next.config.ts:8`
- Dockerfile builds with `npm ci` and `npm run build` on `node:24-alpine`. `Dockerfile:1`, `Dockerfile:4`, `Dockerfile:6`
- Dockerfile runs `node server.js` on `HOSTNAME=0.0.0.0`, `PORT=8007`. `Dockerfile:11`, `Dockerfile:12`, `Dockerfile:17`
- Compose droplets service builds `examples/frameworks/Dockerfile` from the repository root. `docker-compose.yml:8`, `docker-compose.yml:9`
- Compose droplets service publishes `127.0.0.1:${DROPLETS_PORT:-8000}`. `docker-compose.yml:11`
- Compose droplets service `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and this host's `WEB_URL`. `docker-compose.yml:14`
- Compose shop service builds `examples/shop/Dockerfile` and only exposes 8300, never publishes it. `docker-compose.yml:21`, `docker-compose.yml:23`
- Compose shop demo login is `admin` / `droplets`. `docker-compose.yml:26`, `docker-compose.yml:27`
- Compose shop `DROPLETS_SECRET` is a demo value. `docker-compose.yml:30`
- Compose shop `DROPLETS_TRUSTED_ORIGINS` is this host's `WEB_URL`. `docker-compose.yml:32`
- Compose web service publishes `127.0.0.1:${WEB_PORT:-8007}`. `docker-compose.yml:37`
- Compose web service environment: `DROPLETS_INTERNAL_URL`, `DROPLETS_PUBLIC_URL`, `SHOP_INTERNAL_URL`, `SHOP_PUBLIC_URL`. `docker-compose.yml:39`, `docker-compose.yml:42`
- Droplets server's `cors: true` (the Svelte example) lets the basic page load droplets cross-origin. `../../frameworks/svelte/droplets.config.ts:16`
- Basic page droplets: `client`, `ssr-hydrate`, `ssr-nohydrate`, with `who` defaulting to `Next.js`. `app/(basic)/page.tsx:6`, `app/(basic)/page.tsx:14`
- Basic layout loads `${DROPLETS_PUBLIC_URL}/index.js`. `app/(basic)/layout.tsx:11`
- Basic fragment fetch sends `accept: text/html` and `x-droplet-location: DROPLETS_PUBLIC_URL` with `cache: "no-store"`, never follows a redirect, 5 second timeout. `lib/droplets.ts:26`, `lib/droplets.ts:27`, `lib/droplets.ts:28`, `lib/droplets.ts:29`
- Basic page pastes only a 2xx or 500 `text/html` answer; anything else renders an inline `<p class="error">`, the id and the error escaped. `lib/droplets.ts:33`, `lib/droplets.ts:39`, `lib/droplets.ts:41`
- `DROPLETS_INTERNAL_URL` and `DROPLETS_PUBLIC_URL` default to `http://localhost:8000`. `lib/droplets.ts:5`, `lib/droplets.ts:8`
- `SHOP_INTERNAL_URL` defaults to `http://localhost:8300`, `SHOP_PUBLIC_URL` to `http://localhost:8007`. `lib/shop-page.tsx:12`, `lib/shop-page.tsx:13`
- Shop `x-droplet-location` is the origin of `SHOP_PUBLIC_URL`, never the request's Host. `lib/shop.ts:103`, `lib/shop.ts:108`
- Shop proxy route handlers: `app/index.js`, `app/env.js`, `app/index.css`, `app/droplets/[[...path]]`, `app/assets/[...path]`, `app/api/[...path]`, all `force-dynamic`. `app/index.js/route.ts:5`, `app/env.js/route.ts:5`, `app/index.css/route.ts:5`
- Shop proxy route handlers export GET, HEAD, POST, PUT, PATCH, DELETE and OPTIONS. `app/droplets/[[...path]]/route.ts:9`
- Shop proxy request headers allowlist: accept, accept-language, content-type, if-none-match, origin, referer, user-agent, x-droplet-props, x-droplets-build, plus `cookie` cut down to `cart_id` and `shop_admin` (`SHOP_COOKIES`). `lib/shop.ts:49`, `lib/shop.ts:75`, `lib/shop.ts:111`
- Shop upstream timeouts: the proxy 15 s, a fragment 10 s, the product lookup 5 s. `lib/shop.ts:121`, `lib/shop.ts:152`, `lib/shop.ts:184`
- Shop proxy concatenates the path onto the shop's URL, so `//elsewhere` stays a path on the shop. `lib/shop.ts:118`
- Shop proxy never follows redirects and streams the request body (`duplex: "half"`). `lib/shop.ts:123`, `lib/shop.ts:125`
- Shop proxy drops connection, content-encoding, content-length, keep-alive and transfer-encoding from the answer. `lib/shop.ts:62`
- Shop proxy passes every `Set-Cookie` on untouched. `lib/shop.ts:132`
- Shop proxy answers 502 `The shop is unreachable.` when the shop is down. `lib/shop.ts:137`
- The route handler folders decide what is proxied; `lib/shop.ts` lists no paths of its own. `app/index.js/route.ts:5`
- Shop pages (`/gallery`, `/product/:slug`, `/admin`, `/login`) answer `cache-control: private, no-store`, set in `next.config.ts` since a server component cannot set headers. `next.config.ts:11`, `next.config.ts:13`, `next.config.ts:17`
- Shop fragment fetch sends `accept: text/html`, the page URL as `Referer` and the browser's `Cookie` cut down to the shop's. `lib/shop.ts:148`, `lib/shop.ts:149`
- Shop fragment is inserted only when it is 2xx or 500 and `text/html`. `lib/shop.ts:160`
- Shop fragment that is not inserted becomes `<p class="shop-unavailable">`. `lib/shop.ts:174`
- Shop fragment body that is not inserted is read, not cancelled (Next's fetch tees it). `lib/shop.ts:169`
- Shop product lookup reads `/droplets/product-page/_data?slug=`; an unknown product is `notFound()`. `lib/shop.ts:180`, `app/(shop)/product/[slug]/page.tsx:15`
- Shop `Link` preloads kept: `preload` and `modulepreload` on this host's origin only. `lib/shop.ts:216`, `lib/shop.ts:223`
- Shop pages fetch `toast-center` and `shopping-cart?variant=badge` with every page. `lib/shop-page.tsx:45`, `lib/shop-page.tsx:46`
- Shop fragment `Set-Cookie` on a page render is dropped with a warning. `lib/shop-page.tsx:52`
- Shop fragment redirect becomes `redirect(location, RedirectType.replace)`, a 307. `lib/shop-page.tsx:54`
- Shop fragment wrapper is a `display: contents` div with `suppressHydrationWarning`. `lib/shop-page.tsx:63`
- Shop layout loads `/shop.css` and `/index.js` from this origin, and speculation rules prefetch `/product/*`. `app/(shop)/layout.tsx:4`, `app/(shop)/layout.tsx:15`, `app/(shop)/layout.tsx:17`
- Shop gallery passes the whole query to `product-filter` and `product-library`. `app/(shop)/gallery/page.tsx:9`
- Shop product page: `product-comments` gets `order`, `page`, `showing` and `productId`; `product-page` gets `slug` and `v`. `app/(shop)/product/[slug]/page.tsx:18`, `app/(shop)/product/[slug]/page.tsx:22`
- Shop login page passes `next`; admin page passes `view` and `id`. `app/(shop)/login/page.tsx:9`, `app/(shop)/admin/page.tsx:9`
- Shop footer stack label is `Next.js 16`. `lib/shop-page.tsx:9`
- `server-only` guards `lib/droplets.ts`, `lib/shop.ts` and `lib/shop-page.tsx`. `lib/droplets.ts:1`, `lib/shop.ts:13`, `lib/shop-page.tsx:1`
- `pnpm test:hosts nextjs` tests `http://localhost:8007`. `../../../tests/hosts/run.mjs:67`
- `examples/hosts/*` is outside the pnpm workspace. `../../../pnpm-workspace.yaml:5`

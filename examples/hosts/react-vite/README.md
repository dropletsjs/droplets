# React (Vite SPA)

Droplets embedded in a React 19 single-page app built with Vite. A SPA has
no server of its own, so it cannot paste fragments in before the page
ships: it fetches them from the browser. `/` shows the Svelte example's
droplets; `/gallery`, `/product/<slug>`, `/login` and `/admin` render the
[shop demo](../../shop) as client-rendered pages.

```bash
docker compose up --build
open http://localhost:8004            # the basic page
open http://localhost:8004/gallery    # the shop (admin / droplets on /login)
```

The compose file starts three services: the Svelte example's droplets
server on `http://localhost:8000`, the shop (reached only by the app's
nginx) and the built app, served by nginx on `http://localhost:8004`. Both
published ports listen on `127.0.0.1` only.

Without Docker, with a droplets server already running on port 8000 (and
the shop on 8300, started with
`DROPLETS_TRUSTED_ORIGINS=http://localhost:8004`, for the shop pages):

```bash
npm install
npm run dev
```

## Details

### The `<Droplet>` component (`src/droplets.tsx`)

Two modes:

- **`fragment`** (default): fetches `GET /droplets/<id>` from the browser
  and inserts the server-rendered HTML through a `<template>`, so the
  element upgrades on insert. The droplet's own JavaScript then hydrates
  it. Good for content that should be visible immediately.
- **`client`**: renders the droplet element (`<djs-svelte>`, the Svelte
  example's `element` setting; `VITE_DROPLETS_ELEMENT` overrides it) with
  `data-droplet` and a base64 `data-context` directly. It loads from where
  `/index.js` came from, fetches its data from `/droplets/<id>/_data` and
  mounts the component. Nothing shows until the bundle loads.

Either way, `ensureDropletsClient()` adds `/index.js` to the page once.
React owns the wrapper `<div>`; the custom element owns everything inside
it. `VITE_DROPLETS_URL` (build time) points the app at a droplets server
elsewhere. The page and the droplets server are different origins, so the
droplets server runs with `cors: true`.

### The shop demo (`src/shop/`)

The shop pages use the layout every host in `examples/hosts/` shares
(`src/shop/shop.css` is the same file as the others). A tiny history
router (`src/router.ts`) picks the shop or the basic page.

The shop is proxied under this app's origin, so its cart and admin cookies
are first-party and nothing is cross-origin: `/index.js`, `/env.js`, `/index.css`, `/droplets/*`,
`/assets/*` and `/api/*` go to the shop with a fixed `x-droplet-location`
(`SHOP_PUBLIC_URL`, default `http://localhost:8004`), never the client's
Host, with `Forwarded` and `X-Forwarded-*` removed and the browser's
`Cookie` cut down to the shop's own `cart_id` and `shop_admin`.

- In the image, nginx proxies (`nginx.conf`, which answers every other
  route with `index.html`).
- Under `vite dev` and `vite preview`, `server.proxy` does, to
  `SHOP_INTERNAL_URL` (default `http://localhost:8300`).
- The app's own build output lives under `/app/`, so `/assets/*` stays the
  shop's.

Pages fetch their fragments from the browser with `redirect: "manual"` and
insert one only when it is HTML (2xx, or a 500 carrying the droplet's
error page). The cart badge (`shopping-cart`) and the toasts
(`toast-center`, first in the layout) are client-only `<djs-shop>`
elements with `data-params`. Login and the other forms are full-page posts
through the proxy: the shop's `303` and `Set-Cookie` reach the browser as
they are. A product link with an old `v` redirects; the page replaces the
URL with one without it.

The SPA renders its pages in the browser, so without JavaScript it shows
nothing: the host flow's no-JavaScript test skips this host.

### Environment

| Variable | Read by | Default | Used for |
|---|---|---|---|
| `VITE_DROPLETS_URL` | the app, at build | `http://localhost:8000` | the droplets server's browser-facing origin |
| `VITE_DROPLETS_ELEMENT` | the app, at build | `djs-svelte` | the droplets server's element name |
| `SHOP_INTERNAL_URL` | `vite dev`/`preview` | `http://localhost:8300` | how the dev server reaches the shop |
| `SHOP_PUBLIC_URL` | `vite dev`/`preview`, the image's nginx | `http://localhost:8004` | sent to the shop as `x-droplet-location` |

`docker-compose.yml` reads `WEB_PORT`, `WEB_URL`, `DROPLETS_PORT` and
`DROPLETS_URL` (defaults 8004 and 8000) to move the published ports and
public URLs.

### Changing this example

It is outside the pnpm workspace, with its own `package-lock.json`. From
the repository root, `pnpm typecheck:hosts react-vite` runs `npm ci` and
`npm run typecheck` here, and `pnpm test:hosts react-vite` runs the shop
flow against the compose stack (needs Docker).

## Facts

- React version range is `^19.2.0`, Vite `^8.0.0`, `@vitejs/plugin-react` `^6.0.0`. `package.json:13`, `package.json:21`, `package.json:19`
- Dependencies are `react` and `react-dom`: no package from this repository. `package.json:12`
- `npm run typecheck` runs `tsc --noEmit`. `package.json:10`
- Dockerfile builds on `node:24-alpine` with `npm ci` and `npm run build`, `VITE_DROPLETS_URL` as a build arg. `Dockerfile:1`, `Dockerfile:4`, `Dockerfile:6`, `Dockerfile:8`
- Dockerfile serves `dist/` with `nginx:1.27-alpine`, `nginx.conf` as a template, `SHOP_PUBLIC_URL` default `http://localhost:8004`. `Dockerfile:10`, `Dockerfile:12`, `Dockerfile:13`, `Dockerfile:14`
- Compose droplets service builds `examples/frameworks/Dockerfile` from the repository root. `docker-compose.yml:8`, `docker-compose.yml:9`
- Compose droplets service publishes `127.0.0.1:${DROPLETS_PORT:-8000}`. `docker-compose.yml:11`
- Compose droplets service `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and this host's `WEB_URL`. `docker-compose.yml:14`
- Compose shop service builds `examples/shop/Dockerfile` and only exposes 8300. `docker-compose.yml:21`, `docker-compose.yml:23`
- Compose shop demo login is `admin` / `droplets`. `docker-compose.yml:26`, `docker-compose.yml:27`
- Compose shop `DROPLETS_SECRET` is a demo value. `docker-compose.yml:30`
- Compose shop `DROPLETS_TRUSTED_ORIGINS` is this host's `WEB_URL`. `docker-compose.yml:32`
- Compose web service passes `VITE_DROPLETS_URL` as a build arg and publishes `127.0.0.1:${WEB_PORT:-8004}:80`. `docker-compose.yml:38`, `docker-compose.yml:40`
- Compose web service `SHOP_PUBLIC_URL` is this host's `WEB_URL`. `docker-compose.yml:43`
- Droplets server's `cors: true` (the Svelte example) lets the basic page load droplets cross-origin. `../../frameworks/svelte/droplets.config.ts:16`
- `VITE_DROPLETS_URL` defaults to `http://localhost:8000`, `VITE_DROPLETS_ELEMENT` to `djs-svelte`. `src/droplets.tsx:5`, `src/droplets.tsx:9`
- `ensureDropletsClient()` adds `<origin>/index.js` once per page. `src/droplets.tsx:14`
- `<Droplet>` client mode sets `data-droplet` and `data-context` (base64 JSON `{ props }`). `src/droplets.tsx:24`, `src/droplets.tsx:58`, `src/droplets.tsx:59`
- `<Droplet>` fragment mode fetches `/droplets/<id>` with props as query parameters, `accept: text/html` and `redirect: "manual"`, and inserts it through a `<template>`. `src/droplets.tsx:65`, `src/droplets.tsx:68`, `src/droplets.tsx:80`
- `<Droplet>` fragment mode inserts only a `text/html` answer that is 2xx or 500 (the droplet's error page); a redirect or any other answer is an error. `src/droplets.tsx:72`, `src/droplets.tsx:75`
- `<Droplet>` that fails renders `<p className="error">`. `src/droplets.tsx:97`
- Basic page: `ssr-hydrate` and `ssr-nohydrate` as fragments, `client` in client mode, `who` defaulting to `React`. `src/App.tsx:5`, `src/App.tsx:8`, `src/App.tsx:25`
- Router: shop paths are `/gallery`, `/login`, `/admin`, `/product/<slug>`; everything else is the basic page. `src/shop/ShopApp.tsx:10`, `src/main.tsx:10`
- Router re-renders on `popstate`; `navigate()` pushes and dispatches `popstate`. `src/router.ts:10`, `src/router.ts:23`
- Shop element is `djs-shop`. `src/shop/ShopDroplet.tsx:12`
- Shop `/index.js` is loaded once from this origin. `src/shop/ShopDroplet.tsx:16`, `src/shop/ShopDroplet.tsx:19`
- Shop fragment fetch uses `redirect: "manual"` and `accept: text/html`. `src/shop/ShopDroplet.tsx:52`
- Shop fragment redirect (`opaqueredirect`) calls `onRedirect`, or shows the droplet as unavailable. `src/shop/ShopDroplet.tsx:57`
- Shop fragment is inserted only when it is 2xx or 500 and `text/html`. `src/shop/ShopDroplet.tsx:63`
- Shop client-only droplets are `<djs-shop>` with `data-droplet` and `data-params` (JSON). `src/shop/ShopDroplet.tsx:103`, `src/shop/ShopDroplet.tsx:104`
- Shop layout: `toast-center` first, `shopping-cart` with `variant: "badge"` in the header, both client-only. `src/shop/ShopApp.tsx:50`, `src/shop/ShopApp.tsx:68`
- Shop product lookup reads `/droplets/product-page/_data?slug=`; `null` renders Not found. `src/shop/ShopDroplet.tsx:121`, `src/shop/ShopApp.tsx:127`
- Shop gallery passes the whole query to `product-filter` and `product-library`. `src/shop/ShopApp.tsx:104`, `src/shop/ShopApp.tsx:107`
- Shop product page: `product-comments` gets `order`, `page`, `showing` and `productId`; `product-page` gets `slug` and `v`. `src/shop/ShopApp.tsx:141`, `src/shop/ShopApp.tsx:145`
- Shop product page with an old `v`: the redirect replaces the URL with one without `v`. `src/shop/ShopApp.tsx:150`, `src/shop/ShopApp.tsx:161`
- Shop login page passes `next`; admin page passes `view` and `id`. `src/shop/ShopApp.tsx:43`, `src/shop/ShopApp.tsx:44`
- Shop footer stack label is `React 19 + Vite`. `src/shop/ShopApp.tsx:7`
- Image nginx proxies `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*` to `shop:8300`. `nginx.conf:26`, `nginx.conf:27`
- Image nginx sets `x-droplet-location` to `${SHOP_PUBLIC_URL}`, never the request's Host. `nginx.conf:29`
- Image nginx clears `Forwarded`, `X-Forwarded-Host`/`-Proto`/`-Prefix`/`-For`. `nginx.conf:30`, `nginx.conf:34`
- Image nginx sends the shop only `cart_id` and `shop_admin`, from the `$shop_cookie` map. `nginx.conf:8`, `nginx.conf:28`
- Image nginx `client_max_body_size` is 4m. `nginx.conf:36`
- Image nginx answers every other route with `index.html`. `nginx.conf:42`
- Vite proxy reads `SHOP_INTERNAL_URL` (default `http://localhost:8300`) and `SHOP_PUBLIC_URL` (default `http://localhost:8004`) with `loadEnv(mode, ".", "SHOP_")`. `vite.config.ts:34`, `vite.config.ts:37`, `vite.config.ts:38`
- Vite proxy sends `x-droplet-location: SHOP_PUBLIC_URL`, removes `forwarded` and `x-forwarded-*`, and cuts `cookie` down to `cart_id` and `shop_admin`. `vite.config.ts:9`, `vite.config.ts:12`, `vite.config.ts:44`, `vite.config.ts:49`, `vite.config.ts:50`
- Vite proxy covers `^/index\.js$`, `^/env\.js$`, `^/index\.css$`, `/droplets/`, `/assets/`, `/api/`. `vite.config.ts:56`
- Vite `build.assetsDir` is `app`, so `/assets/*` stays the shop's. `vite.config.ts:61`
- Vite dev and preview listen on 8004 with `strictPort`. `vite.config.ts:62`, `vite.config.ts:63`
- No-JavaScript host test skips this host (`react*`). `../../../tests/hosts/e2e/shop.spec.ts:247`
- `pnpm test:hosts react-vite` tests `http://localhost:8004`. `../../../tests/hosts/run.mjs:64`
- `examples/hosts/*` is outside the pnpm workspace. `../../../pnpm-workspace.yaml:5`

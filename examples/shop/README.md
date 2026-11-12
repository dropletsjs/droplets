# Shop

A demo shop as one droplets server: nine droplets in six frameworks on
SQLite, with form actions that work without JavaScript, cookies, uploads, a
login and an admin. Its element is `<djs-shop>`. Every host example in
[`examples/hosts`](../hosts) except WordPress and htmx builds the same pages
around it (`/gallery`, `/product/<slug>`, `/login`, `/admin`); the docs'
[shop demo](https://dropletsjs.dev/integrate/hosts/shop-demo/) shows each one
recorded.

From the repository root, after `pnpm install` and `pnpm build`:

```bash
cp examples/shop/.env.example examples/shop/.env   # the demo values, once
pnpm dev:shop                                      # vite dev on http://localhost:5174
```

The login is **admin / droplets**.

## Details

### The droplets

| Droplet | Framework | Mode |
| ------- | --------- | ---- |
| `product-filter` | Hono JSX | server-rendered, hydrates on the first interaction |
| `product-library` | Svelte | server-rendered, hydrated |
| `product-card` | Svelte | server-rendered, hydrates when visible |
| `product-page` | Handlebars | server-rendered, prerendered per product, no JavaScript |
| `product-comments` | Solid | server-rendered, prerendered, hydrates when visible |
| `shopping-cart` | React | client-only |
| `toast-center` | Solid | client-only |
| `login` | Hono JSX | server-rendered, no JavaScript |
| `product-admin` | Vue | server-rendered, hydrated |

[`CONTRACT.md`](./CONTRACT.md) is the contract for hosts: every droplet's
props, the events they send each other on `window`, the JSON API and the
headers a host must pass.

### Run and build

```bash
pnpm --filter @dropletsjs/example-shop build   # seeds shop.db if missing, then dist/server.js
pnpm --filter @dropletsjs/example-shop start   # http://localhost:8300, reads .env
pnpm test:example:shop                         # the tests (vitest), after the build
```

`dev` and `build` seed `shop.db` from `data/` when it is missing;
`pnpm --filter @dropletsjs/example-shop seed` seeds it again. The build
reads the database: `product-page` prerenders one page per product and
`product-comments` every comment page already full.

### Environment

[`.env.example`](./.env.example) has the demo values. Real deployments set
their own.

| Variable | What it does |
| --- | --- |
| `ADMIN_USER`, `ADMIN_PASSWORD` | the one admin; login is refused while either is unset |
| `SHOP_SECRET` | signs the `shop_admin` cookie; under 32 characters the login answers 503 |
| `DROPLETS_SECRET` | signs a form's result when JavaScript is off (Post/Redirect/Get) |
| `DROPLETS_TRUSTED_ORIGINS` | the host origins whose pages post forms here and get a stale product link sent back, comma-separated |
| `SHOP_DATABASE`, `SHOP_IMAGES`, `SHOP_UPLOADS` | where the database, the seeded images and the uploads live |

### Docker

```bash
docker build -f examples/shop/Dockerfile -t droplets-shop .   # from the repository root
docker run --rm -p 8300:8300 \
  -e ADMIN_PASSWORD=droplets -e SHOP_SECRET=$(openssl rand -hex 32) \
  -e DROPLETS_SECRET=$(openssl rand -hex 32) droplets-shop
```

The database is seeded at image build and lives in the container: a new
container starts from the seed again.

### The data

`data/products.json` and `data/comments.json` are committed; the seed reads
them, never a network. `pnpm --filter @dropletsjs/example-shop generate:data`
rewrites their text with an LLM, a development tool run once: it needs
`LLM_URL` (the base URL of an OpenAI-compatible server, without `/v1`) and
`LLM_MODEL`, from the environment or the repository's `.env.local`.
`generate:images` does the same for the product images with a ComfyUI server
(`COMFY_URL`).

## Facts

- Shop element is `djs-shop`. `droplets.config.ts:7`
- Shop `cors` is on, for a host that embeds cross-origin; such a host gets no cookies. `droplets.config.ts:14`
- Shop `trustedOrigins` is empty in the config; host origins come from `DROPLETS_TRUSTED_ORIGINS` at runtime. `droplets.config.ts:22`
- Multipart body limit is 3 MB; an uploaded image is at most 2 MB. `droplets.config.ts:25`, `src/lib/server/images.ts:15`
- Dev server port 5174, production server port 8300. `droplets.config.ts:27`, `droplets.config.ts:28`
- Shop builds for Node only (SQLite through better-sqlite3, images on disk). `vite.config.ts:18`
- Renderers: Svelte, Vue, React, Solid, Hono JSX, Handlebars. `vite.config.ts:19`
- Tailwind is off: `src/app.css` is plain CSS. `vite.config.ts:21`
- `product-filter` is `ssr = true`, `hydrate = "interactive"`. `src/droplets/product-filter/+droplet.tsx:13`
- `product-library` is `ssr = true`, `hydrate = true`. `src/droplets/product-library/+droplet.svelte:2`
- `product-card` is `ssr = true`, `hydrate = "visible"`. `src/droplets/product-card/+droplet.svelte:4`
- `product-page` is `ssr = true`, `hydrate = false`, `prerender = true`. `src/droplets/product-page/+droplet.hbs:2`
- `product-page` prerender entries are one `{ slug, v }` per product version. `src/droplets/product-page/+droplet.server.ts:15`
- `product-comments` is `ssr = true`, `hydrate = "visible"`, `prerender = true`. `src/droplets/product-comments/+droplet.tsx:20`
- `product-comments` prerender entries are the `oldest`-order pages already full at build, for every page size. `src/lib/comment-entries.ts:12`, `src/droplets/product-comments/+droplet.server.ts:14`
- `product-comments` props: `productId`, `order` (`oldest` default or `newest`), `page` (default 1), `showing` (10, 20, 25 or 50; default 10). `src/lib/schemas.ts:59`, `src/lib/schemas.ts:56`
- `shopping-cart` is `ssr = false`, `hydrate = true`. `src/droplets/shopping-cart/+droplet.tsx:22`
- `toast-center` is `ssr = false`, `hydrate = true`. `src/droplets/toast-center/+droplet.tsx:24`
- `login` is `ssr = true`, `hydrate = false`. `src/droplets/login/+droplet.tsx:11`
- `product-admin` is `ssr = true`, `hydrate = true`. `src/droplets/product-admin/+droplet.vue:2`
- Login action `?/login` answers `fail(401)` for a wrong user or password, without echoing them. `src/droplets/login/+droplet.server.ts:21`
- Login action answers `fail(503)` when `SHOP_SECRET` is unset or shorter than 32 characters. `src/droplets/login/+droplet.server.ts:24`, `src/lib/server/admin.ts:18`
- `SHOP_SECRET` with `.env.example`'s `demo-only-` prefix is refused once `NODE_ENV` is `production`, said once with `console.error`: the login answers 503 and no session reads. `src/lib/server/admin.ts:19`
- Login success sets `shop_admin` and redirects 303 to `props.next`, never a form field. `src/droplets/login/+droplet.server.ts:25`
- Logout action `?/logout` deletes `shop_admin` and redirects 303 to `/gallery`. `src/droplets/login/+droplet.server.ts:30`
- Admin actions answer `fail(401)` without a session. `src/lib/server/admin.ts:29`
- Admin credentials are compared in constant time (SHA-256 hashes, `timingSafeEqual`), user and password both every time. `src/lib/server/auth.ts:19`, `src/lib/server/auth.ts:33`
- Admin session cookie `shop_admin` is `<user>.<expiry>.<HMAC-SHA256>`, no session store. `src/lib/server/auth.ts:6`, `src/lib/server/auth.ts:40`
- Admin session lasts 8 hours; the cookie is `HttpOnly`, `SameSite=Lax`, path `/`. `src/lib/server/auth.ts:12`, `src/lib/server/auth.ts:14`
- Admin session MAC is checked in constant time before the expiry is checked. `src/lib/server/auth.ts:55`
- Cart cookie `cart_id` lasts 30 days, `HttpOnly`, `SameSite=Lax`, path `/`. `src/lib/server/cart.ts:13`, `src/lib/server/cart.ts:15`
- Cart line quantity is clamped to the stock and to 20. `src/lib/server/cart.ts:22`, `src/lib/server/cart.ts:104`
- `handle` reads the admin session and the cart id into `locals`, except at build. `src/hooks.server.ts:26`, `src/hooks.server.ts:27`
- `handle` sets `locals.page` and `event.host` from the `Referer` when its origin is the shop's own or, with `DROPLETS_TRUSTED_ORIGINS` set, a trusted one; a relative redirect after an action lands on that page. `src/hooks.server.ts:28`, `src/hooks.server.ts:47`
- A stale `v` redirects 302 to `locals.page` without `v`; without such a page the product page renders live. `src/droplets/product-page/+droplet.server.ts:57`
- `/api/cart*` and `/api/auth*` answer `cache-control: private, no-store`. `src/hooks.server.ts:17`, `src/hooks.server.ts:34`
- `handleError` logs the error and answers `Something broke in the shop.`. `src/hooks.server.ts:38`
- Client `init` installs `window.shopMessageQueue` before any droplet starts and relays `product-page` adds as toasts. `src/hooks.client.ts:7`
- Window events: `shop:filter`, `shop:cart-changed`, `shop:product-changed`, `shop:cart-open`. `src/lib/events.ts:10`
- `GET /api/products` `limit` is 1 to 48, default 12. `src/api/products/+server.ts:16`
- JSON API routes: `/api/products`, `/api/stock/check`, `/api/cart`, `/api/cart/items`, `/api/cart/items/<productId>`, `/api/comments`, `/api/images/<key>`, `/api/auth/me`, one `+server.ts` each. `src/api/products/+server.ts:24`, `src/api/auth/me/+server.ts:8`
- Image keys are a seeded slug `.webp` or an upload `u-<32 hex>.webp|png|jpg`; any other key finds nothing. `src/lib/server/images.ts:12`, `src/lib/server/images.ts:13`
- Database path is `SHOP_DATABASE`, else `shop.db` in the working directory. `src/lib/server/db.ts:47`
- Seeded images come from `SHOP_IMAGES` (default `images/`), uploads go to `SHOP_UPLOADS` (default `.uploads/`). `src/lib/server/images.ts:20`, `src/lib/server/images.ts:21`
- Env variables `ADMIN_USER`, `ADMIN_PASSWORD`, `SHOP_SECRET` are private and read at runtime. `src/env.ts:9`
- Seed `--if-missing` exits when the database exists; `dev` and `build` run it. `scripts/seed.ts:14`, `package.json:8`, `package.json:10`
- `start` runs `node --env-file-if-exists=.env dist/server.js`. `package.json:12`
- `typecheck` runs `djs sync`, `vue-tsc` and `svelte-check`. `package.json:15`
- Tests drive the built `dist/server.js` in-process on a freshly seeded database and fail without a build. `test/server.test.ts:16`
- Tests run one file at a time: the server tests share one database file. `vitest.config.ts:12`
- Generators read the repository's `.env.local`; variables already set win. `scripts/generate-data.mjs:19`, `scripts/generate-images.mjs:19`
- Dockerfile seeds the database at image build, then runs `vite build`. `Dockerfile:52`, `Dockerfile:53`
- Docker image runs `node dist/server.js` as user `node` on port 8300, `ADMIN_USER=admin`, no secret baked in. `Dockerfile:59`, `Dockerfile:66`, `Dockerfile:67`
- Host examples that run the shop build it from this Dockerfile (all but WordPress). `../hosts/express/docker-compose.yml:21`, `../hosts/htmx/docker-compose.yml:24`

# wp-shop

The [shop](../shop)'s droplets with WordPress holding the data: products,
images and reviews read over WordPress's REST API (and prerendered at
start), the admin whoever is logged in to WordPress, and the writes (stock,
price, reviews) sent back to it. Its element is `<djs-shop>`, as the shop's.

It runs behind the WordPress host, [`examples/hosts/wordpress`](../hosts/wordpress):
a WordPress site whose plugin embeds the droplets with a `[droplet]`
shortcode, proxies the droplets routes and serves the REST API wp-shop reads.
The [WordPress tutorial](https://dropletsjs.dev/integrate/wordpress/) builds
it step by step.

```bash
cd examples/hosts/wordpress
docker compose up --build    # WordPress on http://localhost:8008, wp-shop beside it
pnpm test:hosts wordpress    # from the repository root: the flow in a browser
```

## Details

### How it differs from the shop

- **Data**: products, images and comments are WordPress's (`src/lib/server/wp.ts`);
  only the carts are wp-shop's own, in SQLite.
- **Login**: no login droplet and no password. The plugin signs an
  `x-wp-shop-user` header for a logged-in WordPress user who can
  `manage_options`; `src/lib/server/host-identity.ts` verifies it into
  `locals.admin`. Without one, `product-admin` renders a link to
  `wp-login.php`.
- **Writes back**: stock and price edits and new comments go to WordPress's
  REST API, the admin's writes signed with `x-wp-shop-service`.
- **Build at start**: the prerender reads WordPress, so the container builds
  when it starts (`scripts/start.sh`), once WordPress answers.
- **No CORS**: WordPress is the only host and proxies every droplets route
  under its own origin.

### Environment

[`src/env.ts`](./src/env.ts) declares them; [`.env.example`](./.env.example)
has demo values for the WordPress host on `localhost:8008`.

| Variable | What it does |
| --- | --- |
| `WP_INTERNAL_URL` | how wp-shop reaches WordPress's REST API, server to server |
| `WP_PUBLIC_URL` | WordPress's public origin: the only origin a Media Library image may come from |
| `WP_SHOP_HOST_SECRET` | shared with the plugin, WordPress → wp-shop: checks `x-wp-shop-user`; 32+ bytes |
| `WP_SHOP_SERVICE_SECRET` | shared with the plugin, wp-shop → WordPress: signs `x-wp-shop-service`; 32+ bytes, never the host secret |
| `WP_SHOP_DATABASE` | the cart's SQLite file, default `wp-shop.db` |
| `DROPLETS_SECRET` | signs a form's result when JavaScript is off (Post/Redirect/Get) |
| `DROPLETS_TRUSTED_ORIGINS` | WordPress's public origin |

### Outside Docker

With the WordPress host running, `cp .env.example .env`, then
`pnpm --filter @dropletsjs/example-wp-shop dev` (http://localhost:5175) or
`build` and `start` (http://localhost:8310). The build needs WordPress up.

### Tests

`pnpm test:example:wp-shop` at the root runs them without WordPress: they
build and start wp-shop against a stand-in for WordPress's REST API
([`test/mock-wordpress.ts`](./test/mock-wordpress.ts)), including the
signed writes back and malformed answers. The real site is tested by
`pnpm test:hosts wordpress`.

## Facts

- wp-shop element is `djs-shop`, the shop's. `droplets.config.ts:7`
- wp-shop `cors` is off: WordPress proxies `/index.js`, `/droplets`, `/assets` and `/api` under its own origin. `droplets.config.ts:14`
- wp-shop `trustedOrigins` is empty; WordPress's origin comes from `DROPLETS_TRUSTED_ORIGINS` at runtime. `droplets.config.ts:20`
- Dev server port 5175, production server port 8310. `droplets.config.ts:22`, `droplets.config.ts:23`
- wp-shop builds for Node only; renderers Svelte, Vue, React, Solid, Hono JSX, Handlebars; Tailwind off. `vite.config.ts:20`, `vite.config.ts:21`, `vite.config.ts:22`
- Droplets: `product-filter`, `product-library`, `product-card`, `product-page`, `product-comments`, `shopping-cart`, `toast-center`, `product-admin`; no `login`. `src/droplets/product-admin/+droplet.vue:1`
- `product-page` is `ssr = true`, `hydrate = false`, `prerender = true`. `src/droplets/product-page/+droplet.hbs:2`
- `product-comments` is `ssr = true`, `hydrate = "visible"`, `prerender = true`. `src/droplets/product-comments/+droplet.tsx:21`
- `product-filter` is `hydrate = "interactive"`; `product-card` is `hydrate = "visible"`. `src/droplets/product-filter/+droplet.tsx:14`, `src/droplets/product-card/+droplet.svelte:5`
- `shopping-cart` and `toast-center` are `ssr = false`. `src/droplets/shopping-cart/+droplet.tsx:22`, `src/droplets/toast-center/+droplet.tsx:24`
- Env variables `WP_INTERNAL_URL`, `WP_PUBLIC_URL`, `WP_SHOP_HOST_SECRET`, `WP_SHOP_SERVICE_SECRET`, `WP_SHOP_DATABASE` are private and read at runtime and at build. `src/env.ts:7`
- `x-wp-shop-user` is `base64url(JSON claims).base64url(HMAC-SHA256)` keyed with `WP_SHOP_HOST_SECRET`. `src/lib/server/host-identity.ts:8`, `src/lib/server/host-identity.ts:29`
- `x-wp-shop-user` longer than 1024 bytes is not read. `src/lib/server/host-identity.ts:34`, `src/lib/server/host-identity.ts:123`
- `x-wp-shop-user` MAC is verified before any of the payload is decoded. `src/lib/server/host-identity.ts:131`
- `x-wp-shop-user` claims are copied by own key into an object without a prototype; `__proto__` stays data. `src/lib/server/host-identity.ts:147`
- `x-wp-shop-user` claims: `sub` a WordPress login, `role` `administrator`, `exp`, `method`, `path`, `aud`. `src/lib/server/host-identity.ts:104`, `src/lib/server/host-identity.ts:152`
- `x-wp-shop-user` lives at most 60 seconds (plus 5 of clock skew) and binds the request's method, path and query and `aud: "wp-shop"`. `src/lib/server/host-identity.ts:36`, `src/lib/server/host-identity.ts:160`, `src/lib/server/host-identity.ts:161`
- Secrets shorter than 32 bytes are unusable: nothing verifies or signs with them. `src/lib/server/host-identity.ts:39`, `src/lib/server/host-identity.ts:62`
- `WP_SHOP_HOST_SECRET` equal to `WP_SHOP_SERVICE_SECRET` refuses both: no admin, no writes back. `src/lib/server/host-identity.ts:79`
- An `x-wp-shop-user` with no usable host secret warns once and names no admin. `src/lib/server/admin.ts:22`
- Admin actions answer `fail(401)` without a WordPress admin behind the request. `src/lib/server/admin.ts:31`
- `product-admin` without an admin renders a link to `/wp-login.php?redirect_to=<page>`, never a redirect. `src/droplets/product-admin/+droplet.server.ts:21`
- Writes back to WordPress carry `x-wp-shop-service`, signed with `aud: "wordpress"` for the admin. `src/lib/server/wp.ts:389`, `src/lib/server/wp.ts:395`
- `handle` sets `locals.admin` and `locals.cartId`, except at build. `src/hooks.server.ts:30`, `src/hooks.server.ts:31`
- `handle` sets `event.host` from WordPress's `Referer`. `src/hooks.server.ts:35`
- Responses to an admin, and `/api/cart*` and `/api/auth*`, are `cache-control: private, no-store`. `src/hooks.server.ts:21`, `src/hooks.server.ts:38`
- WordPress REST calls go only to paths under `/wp-json/`. `src/lib/server/wp.ts:89`
- WordPress REST calls time out after 5 seconds. `src/lib/server/wp.ts:96`
- WordPress REST answers are read up to 2 MB. `src/lib/server/wp.ts:48`, `src/lib/server/wp.ts:115`
- Products are fetched 100 per page, at most 10 pages. `src/lib/server/wp.ts:49`, `src/lib/server/wp.ts:51`
- Image URLs are kept only on `WP_PUBLIC_URL`'s origin, under `/wp-content/uploads/`, `.webp`, `.png` or `.jpg`, no credentials, query or hash. `src/lib/server/wp.ts:220`, `src/lib/server/wp.ts:233`
- Cart database is `WP_SHOP_DATABASE`, else `wp-shop.db`. `src/lib/server/db.ts:9`
- Container start waits for WordPress, runs `vite build`, then `node dist/server.js`; a restart builds again. `scripts/start.sh:13`, `scripts/start.sh:14`, `scripts/start.sh:15`
- Docker image compiles the packages at image build and the example at container start, on port 8310 as user `node`. `Dockerfile:48`, `Dockerfile:56`, `Dockerfile:58`, `Dockerfile:59`
- WordPress host compose builds wp-shop from this Dockerfile and keeps port 8310 inside the compose network. `../hosts/wordpress/docker-compose.yml:23`, `../hosts/wordpress/docker-compose.yml:25`
- Tests run `vite build` against a stand-in WordPress served from the test process. `test/server.test.ts:28`
- Tests run one file at a time, with a 180 s hook timeout for the build. `vitest.config.ts:11`, `vitest.config.ts:12`

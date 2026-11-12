# WordPress (plugin)

A WordPress site with the **Droplets Embed** plugin (`plugin/droplets-embed`).
Its `[droplet]` shortcode embeds droplets from a droplets server; its
`[shop_droplet]` and `[shop_product]` shortcodes run the shop from
[`examples/wp-shop`](../../wp-shop), with WordPress holding the products,
their comments and the login. The docs tell the same story step by step in
the [WordPress tutorial](https://dropletsjs.dev/integrate/wordpress/).

```bash
docker compose up --build
open http://localhost:8008          # the front page: three Svelte droplets
open http://localhost:8008/gallery  # the shop, once wp-shop serves (docker compose logs -f wp-shop)
open http://localhost:8008/wp-admin # admin / droplets; the Shop screen holds stock and prices
```

Set `WP_SHOP_HOST_SECRET`, `WP_SHOP_SERVICE_SECRET` (two different values) and
`DROPLETS_SECRET` first (32 or more random bytes each, `openssl rand -hex 32`),
in the environment or a `.env` file beside `docker-compose.yml`: compose refuses
to start without them. `pnpm test:hosts wordpress` generates its own for a run.

```
[droplet id="client" who="WordPress"]
[droplet id="ssr-hydrate" who="WordPress"]
[droplet id="ssr-nohydrate" who="WordPress"]
```

Nothing to click through: the `wordpress-init` service (WP-CLI,
`site/init.sh`) installs WordPress once the database is up (admin /
droplets, demo values only), imports the shop's catalogue, builds the pages,
activates **Droplets Embed**, then exits. The first start takes a minute;
after that, put the shortcodes in any post or page. `docker compose down -v`
starts over from an empty site.

| Service | Port | What it is |
|---|---|---|
| `wordpress` | 8008 | WordPress 6 (PHP 8.3, Apache) with the plugin baked in |
| `droplets` | 8000 | the Svelte example (`examples/frameworks/svelte`) as a droplets server |
| `wp-shop` | 8310, compose network only | `examples/wp-shop`, reached through the plugin's proxy |
| `db` | compose network only | MariaDB 11 |
| `wordpress-init` | none | WP-CLI: builds the site, then exits |

## Details

### `[droplet]` (`droplets-embed.php`)

The shortcode fetches `GET /droplets/<id>` with `wp_remote_get`, forwards
every other attribute as a prop, sends `x-droplet-location` set to
`DROPLETS_PUBLIC_URL` so the fragment points at the browser-facing origin,
and enqueues `<DROPLETS_PUBLIC_URL>/index.js` once as a module script. A
droplet that fails renders an inline `<p class="error">`.

The page and the droplets server are different origins, so the droplets
server runs with `cors: true` and lists this site's origin in
`DROPLETS_TRUSTED_ORIGINS`.

The plugin reads its settings with `getenv()`: that works with the official
Docker image, which passes container variables to PHP, and with Apache's
`mod_env`/`PassEnv`. Behind php-fpm, add them to `wp-config.php` instead.

| Variable | Default | What it is |
|---|---|---|
| `DROPLETS_INTERNAL_URL` | `http://localhost:8000` | where WordPress fetches `[droplet]` fragments |
| `DROPLETS_PUBLIC_URL` | `http://localhost:8000` | the browser-facing droplets origin |
| `SHOP_INTERNAL_URL` | `http://localhost:8310` | where WordPress reaches wp-shop (compose: `http://wp-shop:8310`) |
| `SHOP_PUBLIC_URL` | `http://localhost:8008` | this site's public origin, sent to wp-shop as `x-droplet-location` |
| `WP_SHOP_HOST_SECRET` | none | signs `x-wp-shop-user` (WordPress to wp-shop); 32+ bytes |
| `WP_SHOP_SERVICE_SECRET` | none | checks `x-wp-shop-service` (wp-shop to WordPress); 32+ bytes, never equal to the host secret |

### The shop: `examples/wp-shop`

The shop's interface comes from `examples/wp-shop`: the shop demo's
droplets, with WordPress holding the data.

- `shop-catalogue.php` registers the `product` post type (`show_in_rest` at
  `wp/v2/products`, not public) and its meta: `shop_price_cents`,
  `shop_stock`, `shop_sale_pct`, `shop_category`, `shop_details`, with a
  "Shop" meta box in wp-admin. Reviews are the products' WordPress comments,
  which wp-shop posts anonymously over REST.
- `site/import.php` (`wp eval-file`, by `wordpress-init`) imports
  `examples/shop`'s mock data once: 20 products as posts with meta, their
  images into the Media Library, 278 comments.
- The `wp-shop` service waits for the products route, builds (prerendering
  the product pages from WordPress), then serves on 8310, inside the compose
  network only. The carts stay in its own SQLite.
- `shop-identity.php`: there is no shop login. For a logged-in user who can
  `manage_options`, the plugin signs an `x-wp-shop-user` assertion
  (`WP_SHOP_HOST_SECRET`, HMAC-SHA256, for one method and path, 60 seconds)
  on fragment fetches and proxied `/droplets/*` and `/api/*` requests; an
  unsafe request gets one only with this site's `Origin`. wp-shop's writes
  back to the REST API carry `x-wp-shop-service` (`WP_SHOP_SERVICE_SECRET`,
  a secret of its own, for one method, path and body), honoured in `determine_current_user` for
  `POST /wp-json/wp/v2/products/<id>` only and checked again in
  `rest_pre_dispatch`.

### The pages

The pages are ordinary WordPress pages in the stock **Twenty Twenty-Five**
theme: its header, menu and footer. `site/init.sh` builds the site once:

| Page | Template | Content |
| --- | --- | --- |
| Droplets (the front page) | default | the three `[droplet]` shortcodes above |
| Gallery (`/gallery`) | Page No Title | a hero, `[shop_droplet id="product-filter" query="*"]`, `[shop_droplet id="product-library" query="*"]` |
| Product (`/product/<slug>`) | Page No Title | `[shop_product]`: breadcrumbs, the product page, its comments |
| Cart (`/cart`) | Page | `[shop_droplet id="shopping-cart" variant="inline"]` |

plus About, a Journal (the posts page) with two posts, a "Primary" menu
(`wp_navigation`), and the header and footer template parts customized as
the Site Editor saves them (`site/parts/`): the header holds the cart badge
(`[shop_droplet id="shopping-cart" variant="badge"]`), the footer names the
host.

### `[shop_droplet]` and `[shop_product]` (`shop.php`)

`[shop_droplet]` takes the droplet's `id`, `query` (the page's query keys to
pass on, `*` for all) and any other attribute as a fixed prop.

- On `template_redirect`, the plugin finds the shop shortcodes in the page
  and in the header and footer parts and fetches all their fragments on the
  server, in parallel (`Requests::request_multiple`), with the shop's
  `cart_id` cookie only, the admin's assertion, the page URL as `Referer` and
  a fixed `x-droplet-location` (`SHOP_PUBLIC_URL`, never the client's Host).
  Redirects are passed on, not followed; only HTML answers are inserted; the
  fragments' `Set-Cookie` goes back to the browser untouched and their
  `Link` preloads go into the page's head. The shortcodes leave
  placeholders that are filled at the end of the output buffer, so
  WordPress's content filters (`wptexturize`, smilies, image attributes)
  never touch a fragment.
- On a shop page, the `toast-center` droplet is fetched with them and goes
  first in the body (`wp_body_open`, before the theme's header), once per
  page: the toasts listen on `window.shopMessageQueue`, which `/index.js`
  installs.
- `/product/<slug>` maps to the Product page (a rewrite rule, flushed by
  `wordpress-init` and on activation), and the shop's `?page=N` stays the
  shop's on shop pages.
- On `init`, `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*` and `/api/*` are
  proxied to wp-shop (`SHOP_INTERNAL_URL`), so its cart cookie is this
  site's own and nothing is cross-origin. The proxy forwards a short list of
  headers (never a browser's `x-wp-shop-user`) and only the `cart_id`
  cookie. PHP leaves `php://input` empty for multipart posts, so those are
  written out again from `$_POST` and `$_FILES`.

### The Shop screen (`shop-admin.php`)

The shop's admin (the `product-admin` droplet: stock and prices) is no page:
it is the **Shop** screen in wp-admin
(`/wp-admin/admin.php?page=droplets-shop`), for users who can
`manage_options`.

- It is a top-level menu page (`add_menu_page`). The droplet's fragment is
  fetched on `load-<hook>`, before wp-admin prints anything, as the public
  pages do (the admin's assertion for that one GET, the screen's URL as
  `Referer`, the fixed `x-droplet-location`); the page's callback prints it
  inside the screen's wrap, and its `Link` preloads go into the screen's
  head.
- `/index.js` (through the proxy) and `shop-admin.css` are enqueued on that
  screen only (`admin_enqueue_scripts`, by its hook suffix). The droplet's
  own stylesheet is scoped to `<djs-shop>`; `shop-admin.css`, all under
  `#droplets-shop-admin`, sets back what wp-admin's own rules
  (`.wp-core-ui .button`, `.notice`, `.row-actions`, `p`, `b`, inputs) would
  change inside it.
- The droplet's saves post to `/droplets/product-admin?/save` through the
  proxy, which signs them as anywhere else: that method and path, `aud`, and
  only with this site's `Origin`.
- `[shop_droplet id="product-admin"]` renders nothing of it on a public
  page, and `/admin` redirects to the Shop screen (wp-admin sends a visitor
  to `wp-login.php` from there). None of the public droplets (gallery, cart,
  toasts) are in wp-admin.

The compose file sets `SHOP_INTERNAL_URL`, `SHOP_PUBLIC_URL`,
`WP_SHOP_HOST_SECRET` and `WP_SHOP_SERVICE_SECRET` (each from the environment,
the same value on both sides, never equal to each other).

### Tests

From the repository root, `pnpm test:hosts wordpress` (run only when named)
starts this compose stack, waits for `/gallery` and a shop fragment, and runs
`tests/hosts/e2e/shop-wordpress.spec.ts` (the flow with the admin in
wp-admin, the Shop screen's access rules, styles kept apart),
`tests/hosts/e2e/wordpress-service.spec.ts` (`x-wp-shop-service` on the
product write only) and the WordPress cases of
`tests/hosts/e2e/shop.spec.ts`. It needs Docker.

## Facts

- Plugin header: `Droplets Embed`, requires WordPress 6.5 and PHP 8.1. `plugin/droplets-embed/droplets-embed.php:3`, `plugin/droplets-embed/droplets-embed.php:6`, `plugin/droplets-embed/droplets-embed.php:7`
- Plugin activation registers the catalogue and the `/product/<slug>` rule, then flushes rewrite rules. `plugin/droplets-embed/droplets-embed.php:25`
- `DROPLETS_INTERNAL_URL` defaults to `http://localhost:8000`, read with `getenv()`. `plugin/droplets-embed/droplets-embed.php:34`
- `DROPLETS_PUBLIC_URL` defaults to `http://localhost:8000`, read with `getenv()`. `plugin/droplets-embed/droplets-embed.php:40`
- `[droplet]` without an `id` renders `[droplet] needs an id attribute`. `plugin/droplets-embed/droplets-embed.php:55`
- `[droplet]` `id` goes through `sanitize_key`; every other attribute is a prop in the query. `plugin/droplets-embed/droplets-embed.php:53`, `plugin/droplets-embed/droplets-embed.php:61`
- `[droplet]` fetch sends `accept: text/html` and `x-droplet-location: DROPLETS_PUBLIC_URL`, 5 second timeout, no redirect followed. `plugin/droplets-embed/droplets-embed.php:65`, `plugin/droplets-embed/droplets-embed.php:66`, `plugin/droplets-embed/droplets-embed.php:67`
- `[droplet]` pastes only a 2xx or 500 `text/html` answer; a failure or anything else renders `<p class="error">`. `plugin/droplets-embed/droplets-embed.php:70`, `plugin/droplets-embed/droplets-embed.php:81`, `plugin/droplets-embed/droplets-embed.php:82`
- `[droplet]` enqueues `<DROPLETS_PUBLIC_URL>/index.js` once, with `wp_enqueue_script_module` (WordPress 6.5+, the plugin's minimum). `plugin/droplets-embed/droplets-embed.php:6`, `plugin/droplets-embed/droplets-embed.php:100`
- `SHOP_INTERNAL_URL` defaults to `http://localhost:8310`, wp-shop's port; compose sets `http://wp-shop:8310`. `plugin/droplets-embed/shop.php:68`, `docker-compose.yml:65`
- `SHOP_PUBLIC_URL` defaults to `http://localhost:8008` and is reduced to its origin. `plugin/droplets-embed/shop.php:78`
- Shop requests send `x-droplet-location` from `SHOP_PUBLIC_URL`, never the client's Host. `plugin/droplets-embed/shop.php:201`, `plugin/droplets-embed/shop.php:304`
- Shop cookies sent to wp-shop: `cart_id` only; WordPress's login cookies stay on the site. `plugin/droplets-embed/shop.php:60`, `plugin/droplets-embed/shop.php:92`
- Shop proxy forwards only `accept`, `accept-language`, `content-type`, `if-none-match`, `origin`, `referer`, `user-agent`, `x-droplet-props`, `x-droplets-build`, plus `cookie` filtered to `cart_id` (`DROPLETS_SHOP_COOKIES`), never `x-wp-shop-user`. `plugin/droplets-embed/shop.php:33`, `plugin/droplets-embed/shop.php:92`, `plugin/droplets-embed/shop.php:197`
- Shop proxy drops hop-by-hop response headers and passes `Set-Cookie` untouched. `plugin/droplets-embed/shop.php:46`, `plugin/droplets-embed/shop.php:243`
- Shop proxy paths: `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*`, on `init` at priority 0. `plugin/droplets-embed/shop.php:276`, `plugin/droplets-embed/shop.php:287`
- Shop proxy refuses a path with a `.` or `..` segment, once decoded, with 400. `plugin/droplets-embed/shop.php:259`, `plugin/droplets-embed/shop.php:278`
- Shop proxy adds `x-wp-shop-user` on `/droplets/*` and `/api/*` only. `plugin/droplets-embed/shop.php:204`
- Shop proxy rebuilds a multipart body from `$_POST` and `$_FILES` when `php://input` is empty. `plugin/droplets-embed/shop.php:216`, `plugin/droplets-embed/shop.php:147`
- Shop proxy concatenates the path onto `SHOP_INTERNAL_URL`, never follows redirects, 15 second timeout. `plugin/droplets-embed/shop.php:223`, `plugin/droplets-embed/shop.php:227`
- Shop proxy answers 502 `The shop is unreachable.` when wp-shop fails. `plugin/droplets-embed/shop.php:232`
- Shop fragments are fetched in parallel with `Requests::request_multiple`, no redirects followed, 5 second timeout. `plugin/droplets-embed/shop.php:323`, `plugin/droplets-embed/shop.php:326`
- Shop fragment fetch sends `accept: text/html`, `x-droplet-location`, the page URL as `referer` and the visitor's `cookie` filtered to `cart_id`. `plugin/droplets-embed/shop.php:302`, `plugin/droplets-embed/shop.php:307`
- Shop fragment fetch carries its own `x-wp-shop-user` for its path and query. `plugin/droplets-embed/shop.php:318`
- Shop fragment is inserted only for 2xx or 500 with `text/html`; otherwise `<p class="shop-unavailable">`. `plugin/droplets-embed/shop.php:339`, `plugin/droplets-embed/shop.php:347`
- Shop product lookup reads `/droplets/product-page/_data?slug=<slug>`. `plugin/droplets-embed/shop.php:356`
- Shop `Link` preloads keep only `preload` and `modulepreload` on this site's origin. `plugin/droplets-embed/shop.php:388`
- `[shop_droplet]` `query` names the page's query keys to forward, `*` for all; other attributes are fixed props. `plugin/droplets-embed/shop.php:416`, `plugin/droplets-embed/shop.php:430`
- Shop fragments are fetched on `template_redirect` at priority 20, from the page and the header and footer parts. `plugin/droplets-embed/shop.php:485`, `plugin/droplets-embed/shop.php:543`
- Shop page answers a fragment's redirect with its status. `plugin/droplets-embed/shop.php:531`
- Shop page sets `Cache-Control: private, no-store`. `plugin/droplets-embed/shop.php:535`
- Shop page fills shortcode placeholders at the end of the output buffer, after WordPress's content filters. `plugin/droplets-embed/shop.php:540`, `plugin/droplets-embed/shop.php:546`
- Shop page enqueues `/index.js` (through the proxy) as a module. `plugin/droplets-embed/shop.php:541`
- `[shop_product]` without a slug redirects to `/gallery`; an unknown slug answers 404. `plugin/droplets-embed/shop.php:502`, `plugin/droplets-embed/shop.php:537`
- Shop product comments props: `order`, `page`, `showing` from the query, plus `productId`; product page props: `slug`, plus `v`. `plugin/droplets-embed/shop.php:447`, `plugin/droplets-embed/shop.php:448`
- Shop toasts (`toast-center`) go first in the body on `wp_body_open`, once per page. `plugin/droplets-embed/shop.php:630`
- `/product/<slug>` rewrites to the `product` page with the `shop_product` query var. `plugin/droplets-embed/shop.php:643`
- Shop `?page=N` is removed from WordPress's query on a page with a shop shortcode. `plugin/droplets-embed/shop.php:654`
- Shop pages skip `redirect_canonical`, so their query stays. `plugin/droplets-embed/shop.php:665`
- Shop stylesheet `shop.css` is enqueued on every front-end page. `plugin/droplets-embed/shop.php:685`
- Shop admin droplets: `product-admin` only; it never renders on a public page. `plugin/droplets-embed/shop-admin.php:37`, `plugin/droplets-embed/shop.php:591`
- Shop screen is the top-level menu page `droplets-shop`, capability `manage_options`. `plugin/droplets-embed/shop-admin.php:31`, `plugin/droplets-embed/shop-admin.php:34`, `plugin/droplets-embed/shop-admin.php:58`
- Shop screen fetches its fragment on `load-<hook>` and answers 403 without `manage_options`. `plugin/droplets-embed/shop-admin.php:69`, `plugin/droplets-embed/shop-admin.php:82`
- Shop screen enqueues `shop-admin.css` and `/index.js` on its own hook suffix only. `plugin/droplets-embed/shop-admin.php:110`, `plugin/droplets-embed/shop-admin.php:114`
- Shop screen puts its fragment's preloads in `admin_head`. `plugin/droplets-embed/shop-admin.php:118`
- `/admin` on a 404 redirects (302) to the Shop screen. `plugin/droplets-embed/shop-admin.php:140`, `plugin/droplets-embed/shop-admin.php:141`
- `x-wp-shop-user` claims: `sub`, `role: administrator`, `exp` 60 seconds out, `method`, `path`, `aud: wp-shop`, HMAC-SHA256. `plugin/droplets-embed/shop-identity.php:139`, `plugin/droplets-embed/shop-identity.php:148`
- `x-wp-shop-user` is signed only for a logged-in user who can `manage_options`. `plugin/droplets-embed/shop-identity.php:132`
- `x-wp-shop-user` for an unsafe method needs this site's `Origin`. `plugin/droplets-embed/shop-identity.php:136`
- Shop secrets shorter than 32 bytes are ignored. `plugin/droplets-embed/shop-identity.php:60`
- Shop secrets that are equal are both refused, and the log says why. `plugin/droplets-embed/shop-identity.php:79`
- Assertion check: size cap 1024, MAC compared with `hash_equals` before `json_decode`, every claim typed, expiry bounded. `plugin/droplets-embed/shop-identity.php:38`, `plugin/droplets-embed/shop-identity.php:174`, `plugin/droplets-embed/shop-identity.php:177`
- `x-wp-shop-service` logs in only on `POST /wp-json/wp/v2/products/<id>` (optional `_fields`), with no method override and no form fields. `plugin/droplets-embed/shop-identity.php:49`, `plugin/droplets-embed/shop-identity.php:217`
- `x-wp-shop-service` runs in `determine_current_user` at priority 30, after WordPress's cookie check. `plugin/droplets-embed/shop-identity.php:242`
- `x-wp-shop-service` also names the body: its `body` claim is the SHA-256 (hex) of `php://input`, checked with the other claims; a header without one is no good for a write. `plugin/droplets-embed/shop-identity.php:193`, `plugin/droplets-embed/shop-identity.php:224`
- `x-wp-shop-service` user must exist and still be able to `manage_options`. `plugin/droplets-embed/shop-identity.php:237`
- `x-wp-shop-service` request routed anywhere but the product write gets 403 in `rest_pre_dispatch`. `plugin/droplets-embed/shop-identity.php:53`, `plugin/droplets-embed/shop-identity.php:258`
- Catalogue post type `product`: not public, `show_in_rest` at `products`, no rewrite. `plugin/droplets-embed/shop-catalogue.php:46`, `plugin/droplets-embed/shop-catalogue.php:50`, `plugin/droplets-embed/shop-catalogue.php:51`, `plugin/droplets-embed/shop-catalogue.php:53`
- Catalogue meta in REST with a schema: `shop_price_cents`, `shop_stock`, `shop_sale_pct` (0 to 90), `shop_category`, `shop_details` (300 chars). `plugin/droplets-embed/shop-catalogue.php:59`, `plugin/droplets-embed/shop-catalogue.php:70`
- Catalogue meta is written only by a user who can `edit_post`. `plugin/droplets-embed/shop-catalogue.php:57`
- Catalogue categories: `mugs`, `desk`, `bags`, `home`, the same slugs as wp-shop's. `plugin/droplets-embed/shop-catalogue.php:29`
- Catalogue products use the classic editor and a "Shop" meta box. `plugin/droplets-embed/shop-catalogue.php:81`, `plugin/droplets-embed/shop-catalogue.php:86`
- Catalogue comments: anonymous REST comments are allowed on products. `plugin/droplets-embed/shop-catalogue.php:146`
- Import runs once: it does nothing when a product exists. `site/import.php:28`
- Import reads `examples/shop`'s `products.json` and `comments.json` (20 products, 278 comments) from `/shop-data`. `site/import.php:40`, `site/import.php:41`
- Import sets a sale of 20 percent on every fourth product. `site/import.php:89`
- Import sideloads each product's image into the Media Library as its featured image. `site/import.php:96`, `site/import.php:100`
- Site install: admin `admin` / `droplets`, theme Twenty Twenty-Five, permalinks `/%postname%`. `site/init.sh:50`, `site/init.sh:51`, `site/init.sh:54`
- Site comments need no name or email and are not held for a previous approval. `site/init.sh:59`, `site/init.sh:60`
- Site front page is `Droplets`, with the three `[droplet]` shortcodes. `site/init.sh:67`, `site/init.sh:69`
- Site pages: Gallery and Product (Page No Title), Cart, About, Journal (posts page). `site/init.sh:71`, `site/init.sh:76`
- Site header part holds the cart badge `[shop_droplet id="shopping-cart" variant="badge"]`. `site/parts/header.html:10`
- Site init activates the plugin and flushes rewrite rules on every run. `site/init.sh:92`, `site/init.sh:93`
- Site init waits for `wp-config.php` and the database. `site/init.sh:23`
- WordPress image is `wordpress:6-php8.3-apache` with the plugin copied in. `Dockerfile:5`, `Dockerfile:6`
- Init image is `wordpress:cli-php8.3` with `site/` and the shop's data and images. `Dockerfile:10`, `Dockerfile:12`, `Dockerfile:13`
- Init service runs as `33:33` (www-data) with the `shop` build context `../../shop`. `docker-compose.yml:90`, `docker-compose.yml:91`
- Droplets server image is `examples/frameworks/Dockerfile`, the Svelte example by default. `docker-compose.yml:9`, `../../frameworks/Dockerfile:24`
- Droplets server CORS: the Svelte example sets `cors: true`. `../../frameworks/svelte/droplets.config.ts:16`
- Droplets server `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and `WEB_URL` (this site). `docker-compose.yml:14`
- wp-shop `DROPLETS_TRUSTED_ORIGINS` is `WEB_URL`, this site's public origin. `docker-compose.yml:37`
- wp-shop service is exposed on 8310 inside the compose network only. `docker-compose.yml:24`
- wp-shop reaches WordPress at `http://wordpress`; `WP_PUBLIC_URL` is `WEB_URL`. `docker-compose.yml:27`, `docker-compose.yml:28`
- wp-shop has `cors: false`: the browser reaches it only through the plugin's proxy. `../../wp-shop/droplets.config.ts:14`
- wp-shop waits for `/wp-json/wp/v2/products` before it builds. `../../wp-shop/scripts/wait-for-wordpress.mjs:12`
- Shop secrets in compose: `WP_SHOP_HOST_SECRET` and `WP_SHOP_SERVICE_SECRET` are required from the environment (`${VAR:?…}`), the same variable on both services, different from each other. `docker-compose.yml:32`, `docker-compose.yml:33`, `docker-compose.yml:68`, `docker-compose.yml:71`
- Published port binds `127.0.0.1`: droplets `DROPLETS_PORT` (8000), WordPress `WEB_PORT` (8008). `docker-compose.yml:11`, `docker-compose.yml:57`
- Database is MariaDB 11 with demo credentials, in the `db` volume. `docker-compose.yml:42`, `docker-compose.yml:49`
- `pnpm test:hosts wordpress` runs only when named, against `http://localhost:8008`. `../../../tests/hosts/run.mjs:63`
- `pnpm test:hosts wordpress` reads the demo service and host secrets from this `docker-compose.yml`. `../../../tests/hosts/e2e/wordpress-service.spec.ts:18`
- `pnpm typecheck:hosts` skips this host: it has no `package.json`. `../../../tests/hosts/typecheck.mjs:20`
- Host is outside the pnpm workspace: `examples/hosts/*` is not listed. `../../../pnpm-workspace.yaml:5`

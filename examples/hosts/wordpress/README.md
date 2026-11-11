# WordPress (plugin)

`plugin/droplets-embed` adds a `[droplet]` shortcode:

```
[droplet id="client" who="WordPress"]
[droplet id="ssr-hydrate" who="WordPress"]
[droplet id="ssr-nohydrate" who="WordPress"]
```

The shortcode fetches `GET /droplets/<id>` with `wp_remote_get`, forwards every
other attribute as a prop, sends `x-droplet-location` so the fragment points at the
browser-facing origin, and enqueues `/index.js` once as a module script.

```bash
docker compose up --build
open http://localhost:8008
```

Nothing to click through: the `wordpress-init` service (WP-CLI,
`site/init.sh`) installs WordPress once the site is up (admin / droplets,
demo values only), imports the shop's catalogue, makes a front page with the
three shortcodes above and the shop's pages below, activates **Droplets
Embed**, then exits. The first start takes a minute; after that,
put the shortcodes in any post or page. `docker compose down -v` starts
over from an empty site.

The plugin reads `DROPLETS_INTERNAL_URL` and `DROPLETS_PUBLIC_URL` from the
environment; the compose file sets them. The page and the droplets server are
different origins, so the droplets server runs with `cors: true`.

The `getenv()` calls work with Apache's `mod_env`/`PassEnv` or the official
Docker image, which exposes container environment variables to PHP. Behind
php-fpm, add the two values to `wp-config.php` instead.

## The shop: examples/wp-shop

The shop's interface comes from `examples/wp-shop`: the shop demo's droplets
with WordPress holding the data (see the docs' [WordPress tutorial](https://dropletsjs.dev/integrate/wordpress/)).

- `plugin/droplets-embed/shop-catalogue.php` registers the `product` post
  type (`show_in_rest` at `wp/v2/products`) and its meta: `shop_price_cents`,
  `shop_stock`, `shop_sale_pct`, `shop_category`, `shop_details`, with a
  "Shop" meta box in wp-admin. Reviews are the products' WordPress comments.
- `site/import.php` (`wp eval-file`, by `wordpress-init`) imports
  examples/shop's mock data once: 20 products as posts with meta, their
  images into the Media Library, 278 comments.
- The `wp-shop` service waits for the products route, builds (prerendering
  the product pages from WordPress), then serves on 8310, inside the
  compose network only. The carts stay in its own SQLite.
- `plugin/droplets-embed/shop-identity.php`: there is no shop login. For a
  logged-in user who can `manage_options`, the plugin signs an
  `x-wp-shop-user` assertion (`WP_SHOP_HOST_SECRET`, HMAC-SHA256, for one
  method and path, 60 seconds) on fragment fetches and proxied requests;
  wp-shop's writes back to the REST API carry `x-wp-shop-service`
  (`WP_SHOP_SERVICE_SECRET`, a secret of its own), checked in
  `determine_current_user` for `POST /wp-json/wp/v2/products/<id>` only.

The pages are ordinary WordPress pages, in the stock **Twenty Twenty-Five**
theme: its header, menu and footer. `site/init.sh` builds the site once:

| Page | Template | Content |
| --- | --- | --- |
| Gallery (`/gallery`) | Page No Title | a hero, `[shop_droplet id="product-filter" query="*"]`, `[shop_droplet id="product-library" query="*"]` |
| Product (`/product/<slug>`) | Page No Title | `[shop_product]`: breadcrumbs, the product page, its comments |
| Cart (`/cart`) | Page | `[shop_droplet id="shopping-cart" variant="inline"]` |

plus About, a Journal (the posts page) with two posts, a "Primary" menu
(`wp_navigation`), and the header and footer template parts customized as
the Site Editor saves them (`site/parts/`): the header holds the cart badge
(`[shop_droplet id="shopping-cart" variant="badge"]`), the footer names the
host. The Svelte example stays the front page.

The shop's admin (the `product-admin` droplet: stock and prices) is no
page: it is the **Shop** screen in wp-admin (`/wp-admin/admin.php?page=droplets-shop`),
for users who can `manage_options`. `plugin/droplets-embed/shop-admin.php`:

- adds the top-level menu page (`add_menu_page`) and fetches the
  droplet's fragment on `load-<hook>`, before wp-admin prints anything, as
  the public pages do (the admin's assertion for that one GET, the
  screen's URL as `Referer`, the fixed `x-droplet-location`); the page's callback
  prints it inside the screen's wrap, and its `Link` preloads go into the
  screen's head;
- enqueues `/index.js` (through the proxy) and `shop-admin.css` on that
  screen only (`admin_enqueue_scripts`, by its hook suffix). The droplet's
  own stylesheet is scoped to `<djs-shop>`; `shop-admin.css`, all under
  the screen's `#droplets-shop-admin`, sets back what wp-admin's own rules
  (`.wp-core-ui .button`, `.notice`, `.row-actions`, `p`, `b`, inputs) would change inside it;
- the droplet's saves post to `/droplets/product-admin?/save` through the
  proxy, which signs them as anywhere else: that method and path, `aud`,
  and only with this site's `Origin`;
- `[shop_droplet id="product-admin"]` renders nothing of it on a public
  page, and `/admin` redirects to the Shop screen (wp-admin sends a
  visitor to `wp-login.php` from there). None of the public droplets
  (gallery, cart, toasts) are in wp-admin.

`[shop_droplet]` takes the droplet's `id`, `query` (the page's query keys to
pass on, `*` for all) and any other attribute as a fixed prop.
`plugin/droplets-embed/shop.php`:

- on `template_redirect`, finds the shop shortcodes in the page and in the
  header and footer parts and fetches all their fragments on the server, in
  parallel (`Requests::request_multiple`), with the shop's `cart_id` cookie
  only, the admin's assertion, the page URL as `Referer` and a fixed `x-droplet-location` (`SHOP_PUBLIC_URL`, never the
  client's Host). Redirects are not followed but passed on, only HTML
  answers are inserted, the fragments' `Set-Cookie` goes back to the browser
  untouched and their `Link` preloads go into the page's head. The
  shortcodes leave placeholders that are filled at the end of the output
  buffer, so WordPress's content filters (`wptexturize`, smilies, image
  attributes) never touch a fragment;
- on a shop page, fetches the `toast-center` droplet with them and puts it
  first in the body (`wp_body_open`, before the theme's header), once per
  page: the toasts, listening on `window.shopMessageQueue` (`/index.js` installs it);
- maps `/product/<slug>` to the Product page (a rewrite rule, flushed by
  `wordpress-init` and on activation), and keeps the shop's `?page=N` from
  WordPress on shop pages;
- proxies `/index.js`, `/droplets/*`, `/assets/*` and `/api/*` to wp-shop
  (`SHOP_INTERNAL_URL`) on `init`, so its cart cookie is this site's own and
  nothing is cross-origin. It forwards a short list of headers (never a
  browser's `x-wp-shop-user`) and only the `cart_id` cookie. PHP leaves
  `php://input` empty for multipart posts, so those are written out again
  from `$_POST` and `$_FILES`.

Open http://localhost:8008/gallery once wp-shop serves
(`docker compose logs -f wp-shop`). The compose file adds the wp-shop
service and sets `SHOP_INTERNAL_URL`, `SHOP_PUBLIC_URL`,
`WP_SHOP_HOST_SECRET` and `WP_SHOP_SERVICE_SECRET` (each the same value on
both sides, never equal to each other; demo only).

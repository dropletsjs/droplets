# PHP

Droplets embedded from plain PHP 8.3 on the official `php:8.3-apache`
image: no framework, no Composer, curl only (built into the image). `/`
renders the Svelte example's three droplets on the server; `/gallery`,
`/product/<slug>`, `/cart`, `/login` and `/admin` embed the
[shop demo](../../shop), proxied under this host's own origin.

```bash
docker compose up --build
open http://localhost:8009            # the basic page
open http://localhost:8009/gallery    # the shop (admin / droplets on /login)
```

Set `SHOP_SECRET` and `DROPLETS_SECRET` first (32 or more random characters
each, `openssl rand -hex 32`), in the environment or a `.env` file beside
`docker-compose.yml`: compose refuses to start without them. `pnpm test:hosts`
generates its own for a run.

The compose file starts three services: the Svelte example's droplets
server on `http://localhost:8000`, the shop (reached only by PHP) and
Apache with PHP on `http://localhost:8009`. Both published ports listen on
`127.0.0.1` only.

## Details

### Layout

Apache sends every path that is not a file in `public/` to
`public/index.php` (`FallbackResource`, `apache.conf`). `public/` is the
document root, so `app/` is never served.

- `public/index.php`: the router and the basic page.
- `app/http.php`: curl, several requests at once (`curl_multi`), plus
  `h()` and `view()`.
- `app/shop.php`: the shop's proxy and pages.
- `app/views/`: the templates.

### The basic page

`/` fetches the three droplets at once, sends `x-droplet-location` set to
`DROPLETS_PUBLIC_URL` so the fragments point at the browser-facing origin,
and prints them into `app/views/index.php`, which loads `/index.js` from
the droplets server once. The browser loads each droplet's JavaScript from
`http://localhost:8000`, a different origin than the page, so the droplets
server runs with `cors: true`. `?who=` is passed to every droplet.

### The shop demo

`app/shop.php` adds five pages that fetch the shop's fragments on the
server, all of a page's at once, into the templates under
`app/views/shop/`. It proxies `/index.js`, `/env.js`, `/index.css`, `/droplets/*` (fragments,
`_data`, form actions), `/assets/*` and `/api/*` to the shop under this
host's own origin, so its cookies (the cart, the admin session) are
first-party and nothing is cross-origin. It follows the shop's
`CONTRACT.md`:

- `x-droplet-location` is the origin of `SHOP_PUBLIC_URL`, written out in
  the environment: never the request's Host. The shop lists that origin in
  `DROPLETS_TRUSTED_ORIGINS`.
- Fragment fetches forward the browser's `Cookie` cut down to the shop's
  own `cart_id` and `shop_admin` (so does the proxy), send the page URL
  (`REQUEST_URI`, query included) as `Referer`, never follow redirects, and
  insert only `text/html` answers (2xx, or a 500 carrying the droplet's
  error page). Their `Set-Cookie` goes back with the page, their `Link`
  preloads into its `<head>`, and a redirect is passed on.
- The proxy forwards an allowlist of the browser's headers and the body as
  it came, refuses a path with a `.` or `..` segment once decoded (400),
  and answers with the shop's status, its headers less the per-hop
  ones (and `Content-Length`/`Content-Encoding`, since curl decodes the
  body), every `Set-Cookie` and any redirect untouched.
- No curl handle has a cookie file, a cookie jar or a share handle, and
  each lives for one request: one visitor's cookies never ride along with
  another's.
- `php.ini` turns `enable_post_data_reading` off, so a multipart post (the
  admin's image upload) stays in `php://input` for the proxy instead of
  being parsed into `$_POST` and `$_FILES`.
- The query is read from `QUERY_STRING` as pairs, so repeated keys and
  names like `a.b` survive (`$_GET` would merge or rename them).
- The layout's stylesheet is `public/shop.css`, the same file in every host.

### Without Docker

With a droplets server on port 8000 and the shop on 8300
(`pnpm --filter @dropletsjs/example-shop build`, then `pnpm start` in
`examples/shop` with `DROPLETS_TRUSTED_ORIGINS=http://localhost:8009`),
PHP's built-in server works too:

```bash
php -d enable_post_data_reading=0 -S localhost:8009 -t public public/index.php
```

### Environment

| Variable | Default | Used for |
|---|---|---|
| `DROPLETS_INTERNAL_URL` | `http://localhost:8000` | how PHP reaches the droplets server |
| `DROPLETS_PUBLIC_URL` | `http://localhost:8000` | the droplets server's browser-facing URL, sent as `x-droplet-location` |
| `SHOP_INTERNAL_URL` | `http://localhost:8300` | how PHP reaches the shop |
| `SHOP_PUBLIC_URL` | `http://localhost:8009` | this host's public origin, sent to the shop as `x-droplet-location` |

`docker-compose.yml` reads `WEB_PORT`, `WEB_URL`, `DROPLETS_PORT` and
`DROPLETS_URL` (defaults 8009 and 8000) to move the published ports and
public URLs.

### Changing this example

No `package.json`: `pnpm typecheck:hosts` skips it. From the repository
root, `pnpm test:hosts php` runs the shop flow against the compose stack
(needs Docker). Errors go to the log (`docker compose logs web`), never
into a page.

## Facts

- Dockerfile is `php:8.3-apache` with `apache.conf`, `php.ini`, `app/` and `public/` copied in; no Composer. `Dockerfile:3`, `Dockerfile:4`, `Dockerfile:5`
- Apache document root is `/var/www/app/public`; `app/` is outside it. `apache.conf:5`, `Dockerfile:6`
- Apache `FallbackResource /index.php` sends every path that is not a file to `public/index.php`. `apache.conf:13`
- Apache `AllowEncodedSlashes NoDecode` lets `%2F` in a path reach PHP. `apache.conf:7`
- Apache directory listing and MultiViews are off. `apache.conf:10`
- `php.ini` sets `enable_post_data_reading = Off`: every body stays in `php://input`. `php.ini:5`
- `php.ini` sets `display_errors = Off`, `log_errors = On`, `expose_php = Off`. `php.ini:8`, `php.ini:9`, `php.ini:10`
- Compose droplets service builds `examples/frameworks/Dockerfile` from the repository root. `docker-compose.yml:8`, `docker-compose.yml:9`
- Compose droplets service publishes `127.0.0.1:${DROPLETS_PORT:-8000}`. `docker-compose.yml:11`
- Compose droplets service `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and this host's `WEB_URL`. `docker-compose.yml:14`
- Compose shop service builds `examples/shop/Dockerfile` and only exposes 8300. `docker-compose.yml:21`, `docker-compose.yml:23`
- Compose shop demo login is `admin` / `droplets`. `docker-compose.yml:26`, `docker-compose.yml:27`
- Shop service `SHOP_SECRET` and `DROPLETS_SECRET` are required from the environment (`${VAR:?…}`), no default. `docker-compose.yml:28`, `docker-compose.yml:30`
- Compose shop `DROPLETS_TRUSTED_ORIGINS` is this host's `WEB_URL`. `docker-compose.yml:32`
- Compose web service publishes `127.0.0.1:${WEB_PORT:-8009}:80`. `docker-compose.yml:37`
- Compose web service environment: `DROPLETS_INTERNAL_URL`, `DROPLETS_PUBLIC_URL`, `SHOP_INTERNAL_URL`, `SHOP_PUBLIC_URL`. `docker-compose.yml:39`, `docker-compose.yml:42`
- `DROPLETS_INTERNAL_URL` and `DROPLETS_PUBLIC_URL` default to `http://localhost:8000`. `public/index.php:17`, `public/index.php:19`
- PHP built-in server: a file in `public/` is served as it is (`return false`). `public/index.php:25`
- Basic page answers only GET and HEAD on `/`; anything unrouted is a plain-text 404. `public/index.php:33`, `public/index.php:57`
- Basic page droplets: `client`, `ssr-hydrate`, `ssr-nohydrate`, with `who` defaulting to `PHP`. `public/index.php:36`, `public/index.php:37`
- Basic fragment fetch sends `accept: text/html` and `x-droplet-location: DROPLETS_PUBLIC_URL`, timeout 5 s. `public/index.php:40`, `public/index.php:41`
- Basic page pastes only a 2xx or 500 `text/html` answer; anything else renders an inline `<p class="error">`. `public/index.php:49`, `public/index.php:51`
- Basic page loads `<DROPLETS_PUBLIC_URL>/index.js`. `app/views/index.php:7`
- Droplets server's `cors: true` (the Svelte example) lets the basic page load droplets cross-origin. `../../frameworks/svelte/droplets.config.ts:16`
- curl: requests in parallel with `curl_multi`, redirects never followed, http and https only. `app/http.php:19`, `app/http.php:39`, `app/http.php:40`
- curl: connect timeout 5 s, request timeout 10 s by default. `app/http.php:19`, `app/http.php:41`
- curl: `CURLOPT_ENCODING => ''` decodes any encoding, so the body passed on is plain. `app/http.php:45`
- curl: no cookie file, cookie jar or share handle; each handle lives for one request. `app/http.php:6`, `app/http.php:83`
- curl: a failed request has status 0 and is logged with `error_log`. `app/http.php:75`, `app/http.php:78`
- `h()` escapes with `htmlspecialchars` (`ENT_QUOTES | ENT_SUBSTITUTE`, UTF-8). `app/http.php:104`
- `SHOP_INTERNAL_URL` defaults to `http://localhost:8300`. `app/shop.php:60`
- Shop `x-droplet-location` is the origin of `SHOP_PUBLIC_URL` (default `http://localhost:8009`), never the request's Host. `app/shop.php:68`, `app/shop.php:70`
- Shop proxy request headers allowlist: accept, accept-language, content-type, if-none-match, origin, referer, user-agent, x-droplet-props, x-droplets-build, plus `cookie` cut down to `cart_id` and `shop_admin` (`SHOP_COOKIES`). `app/shop.php:23`, `app/shop.php:55`, `app/shop.php:183`
- Shop proxy refuses a path with a `.` or `..` segment, once decoded, with 400. `app/shop.php:102`, `app/shop.php:349`
- Shop proxy drops per-hop headers, content-encoding, content-length, and whatever `Connection` names. `app/shop.php:39`, `app/shop.php:201`
- Shop proxied paths: `/index.js`, `/env.js`, `/index.css`, `/droplets/`, `/assets/`, `/api/`. `app/shop.php:164`
- Shop proxy forwards `php://input` as the body for methods other than GET and HEAD. `app/shop.php:187`
- Shop proxy concatenates the raw request target onto the shop's URL, so `//elsewhere` stays a path on the shop. `app/shop.php:190`
- Shop proxy timeout is 15 s; an unreachable shop is 502 `The shop is unreachable.` `app/shop.php:190`, `app/shop.php:194`
- Shop proxy passes every `Set-Cookie` on untouched. `app/shop.php:155`, `app/shop.php:213`
- Shop query is parsed from `QUERY_STRING` as pairs: repeated keys and dotted names kept. `app/shop.php:116`
- Shop fragment fetch sends `accept: text/html`, the page URL as `Referer` and the browser's `Cookie` cut down to the shop's. `app/shop.php:230`, `app/shop.php:231`
- Shop fragment is inserted only when it is 2xx or 500 and `text/html`. `app/shop.php:255`
- Shop fragment that is not inserted becomes `<p class="shop-unavailable">`. `app/shop.php:262`
- Shop product lookup reads `/droplets/product-page/_data?slug=`; an unknown product renders `not-found` with 404. `app/shop.php:272`, `app/shop.php:370`
- Shop product name and category from `_data` are escaped with `h()` in the breadcrumb. `app/views/shop/product.php:3`, `app/views/shop/product.php:4`
- Shop `Link` preloads kept: `preload` and `modulepreload` on this host's origin only. `app/shop.php:302`
- Shop pages send `Cache-Control: private, no-store`. `app/shop.php:320`
- Shop pages pass on every fragment's `Set-Cookie`, then a fragment's redirect with its own status. `app/shop.php:321`, `app/shop.php:324`
- Shop pages fetch `toast-center` and `shopping-cart?variant=badge` with every page. `app/shop.php:319`
- Shop pages answer only GET and HEAD. `app/shop.php:359`
- Shop gallery passes the whole query to `product-filter` and `product-library`. `app/shop.php:366`
- Shop product page: `product-comments` gets `order`, `page`, `showing` and `productId`; `product-page` gets `slug` and `v`. `app/shop.php:373`, `app/shop.php:376`
- Shop cart page renders `shopping-cart?variant=inline`. `app/shop.php:382`
- Shop login page passes `next`; admin page passes `view` and `id`. `app/shop.php:384`, `app/shop.php:386`
- Shop layout loads `/shop.css` and `/index.js` from this origin, with speculation rules for `/product/*`. `app/views/shop/layout.php:7`, `app/views/shop/layout.php:10`, `app/views/shop/layout.php:11`
- Shop footer stack label is `PHP 8.3`. `app/shop.php:20`
- `pnpm test:hosts php` tests `http://localhost:8009`. `../../../tests/hosts/run.mjs:62`
- `examples/hosts/*` is outside the pnpm workspace. `../../../pnpm-workspace.yaml:5`

# Laravel

Droplets embedded from Laravel 13 on PHP 8.5 and Apache (`php:8.5-apache`,
mod_php): the framework alone (`laravel/framework`, no starter kit), its
HTTP client and Blade. `/` renders the Svelte example's three droplets on
the server; `/gallery`, `/product/<slug>`, `/cart`, `/login` and `/admin`
embed the [shop demo](../../shop), proxied under this host's own origin.

```bash
docker compose up --build
open http://localhost:8013            # the basic page
open http://localhost:8013/gallery    # the shop (admin / droplets on /login)
```

Set `SHOP_SECRET` and `DROPLETS_SECRET` first (32 or more random characters
each, `openssl rand -hex 32`), in the environment or a `.env` file beside
`docker-compose.yml`: compose refuses to start without them. `pnpm test:hosts`
generates its own for a run.

The compose file starts three services: the Svelte example's droplets
server on `http://localhost:8000`, the shop (reached only by Laravel) and
Apache with Laravel on `http://localhost:8013`. Both published ports listen
on `127.0.0.1` only.

## Details

### Layout

Apache sends every path that is not a file in `public/` to Laravel's
`public/index.php` (`FallbackResource`, `apache.conf`). `public/` is the
document root, so the app's code is never served.

- `bootstrap/app.php`: the routes outside the `web` middleware group, and
  the global middleware cut down to `ValidatePathEncoding` and
  `ValidatePostSize`.
- `routes/web.php`: the proxied paths (`Route::any`), then the pages.
- `config/services.php`: the two droplets servers' URLs, from the
  environment.
- `app/Shop.php`: the fragments (`Http::pool`), the product lookup and the
  proxy.
- `app/Http/Controllers/`: `ShopController` (the pages),
  `ShopProxyController`, `HomeController` (the basic page).
- `resources/views/`: the Blade views.
- `tests/Feature/`: the feature tests, with `Http::fake()`.

### The basic page

`/` fetches the three droplets at once (`Http::pool`), sends
`x-droplet-location` set to `services.droplets.public_url` so the fragments
point at the browser-facing origin, and prints them into
`resources/views/index.blade.php`, which loads `/index.js` from the
droplets server once. The browser loads each droplet's JavaScript from
`http://localhost:8000`, a different origin than the page, so the droplets
server runs with `cors: true`. `?who=` is passed to every droplet.

### The shop demo

`ShopController` has five pages that fetch the shop's fragments on the
server, all of a page's at once, into the Blade views under
`resources/views/shop/`. `routes/web.php` proxies `/index.js`, `/env.js`,
`/index.css`, `/droplets/*` (fragments, `_data`, form actions), `/assets/*`
and `/api/*` to the shop under this host's own origin, so its cookies (the
cart, the admin session) are first-party and nothing is cross-origin. It
follows the shop's `CONTRACT.md`:

- `x-droplet-location` is the origin of `services.shop.public_url`
  (`SHOP_PUBLIC_URL`), from the config: never the request's Host. The shop
  lists that origin in `DROPLETS_TRUSTED_ORIGINS`.
- Fragment fetches forward the browser's `Cookie` cut down to the shop's
  own `cart_id` and `shop_admin` (so does the proxy), send the page URL
  (`getRequestUri()`, query included) as `Referer`, never follow redirects,
  and insert only `text/html` answers (2xx, or a 500 carrying the droplet's
  error page). Their `Set-Cookie` goes back with the page, their `Link`
  preloads into its `<head>`, and a redirect is passed on.
- The proxy forwards an allowlist of the browser's headers, the method on
  the wire (`getRealMethod()`) and the body as it came, refuses a path with
  a `.` or `..` segment once decoded (400), and answers with the shop's
  status, its headers less the per-hop ones (and
  `Content-Length`/`Content-Encoding`, since the client decodes the body),
  every `Set-Cookie` and any redirect.
- The routes are outside the `web` middleware group: its `EncryptCookies`
  would scramble the shop's cookies and its CSRF check would refuse the
  shop's form posts. Laravel keeps no session and sets no cookie of its own.
- Laravel builds a Guzzle client per request with a cookie jar of its own;
  `withOptions(['cookies' => false])` turns it off, so one visitor's
  cookies never ride along with another's.
- A Laravel response holds cookies as Symfony `Cookie` objects, so each
  `Set-Cookie` from the shop is parsed (`Cookie::fromString`) and written
  out again by Symfony: same name, value and attributes, attribute names
  in lower case.
- `php.ini` turns `enable_post_data_reading` off, so a multipart post (the
  admin's image upload) stays in `php://input` for the proxy instead of
  being parsed into `$_POST` and `$_FILES`.
- The query is read from `QUERY_STRING` as pairs, so repeated keys and
  names like `a.b` survive (`$request->query()`, PHP's `$_GET`, would merge
  or rename them).
- The layout's stylesheet is `public/shop.css`, the same file in every host.

### Without Docker

With PHP 8.4 or later and Composer, a droplets server on port 8000 and the
shop on 8300 (`pnpm --filter @dropletsjs/example-shop build`, then
`pnpm start` in `examples/shop` with
`DROPLETS_TRUSTED_ORIGINS=http://localhost:8013`), PHP's built-in server
works too, with Laravel's router script:

```bash
composer install
php -d enable_post_data_reading=0 -S localhost:8013 -t public vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php
```

### Environment

| Variable | Default | Used for |
|---|---|---|
| `DROPLETS_INTERNAL_URL` | `http://localhost:8000` | how Laravel reaches the droplets server |
| `DROPLETS_PUBLIC_URL` | `http://localhost:8000` | the droplets server's browser-facing URL, sent as `x-droplet-location` |
| `SHOP_INTERNAL_URL` | `http://localhost:8300` | how Laravel reaches the shop |
| `SHOP_PUBLIC_URL` | `http://localhost:8013` | this host's public origin, sent to the shop as `x-droplet-location` |
| `LOG_CHANNEL` | `stderr` in the image | where Laravel logs |

`docker-compose.yml` reads `WEB_PORT`, `WEB_URL`, `DROPLETS_PORT` and
`DROPLETS_URL` (defaults 8013 and 8000) to move the published ports and
public URLs.

### Changing this example

No `package.json`: `pnpm typecheck:hosts` skips it. The feature tests run
in the image's `test` stage, `docker build --target test .`. From the
repository root, `pnpm test:hosts laravel` runs the shop flow against the
compose stack (needs Docker). Errors go to the log
(`docker compose logs web`), never into a page.

## Facts

- Dockerfile builds `vendor/` in a `composer:2` stage (`composer install --no-dev`), from `composer.json` and `composer.lock`. `Dockerfile:3`, `Dockerfile:6`, `Dockerfile:15`
- Dockerfile `test` stage installs the dev dependencies and runs `vendor/bin/phpunit`; compose never builds it. `Dockerfile:18`, `Dockerfile:22`
- Dockerfile runtime is `php:8.5-apache` with `apache.conf`, `php.ini` and the app copied in. `Dockerfile:24`, `Dockerfile:25`, `Dockerfile:26`, `Dockerfile:27`
- Dockerfile sets `LOG_CHANNEL=stderr`. `Dockerfile:30`
- Dockerfile caches the routes and the views, never the config. `Dockerfile:32`
- `composer.json` requires PHP `^8.4` and `laravel/framework` `^13.42`; dev: `phpunit/phpunit`. `composer.json:8`, `composer.json:9`, `composer.json:12`
- Apache document root is `/var/www/app/public`; the app's code is outside it. `apache.conf:6`
- Apache `FallbackResource /index.php` sends every path that is not a file to Laravel. `apache.conf:16`
- Apache `AllowEncodedSlashes NoDecode` lets `%2F` in a path reach Laravel. `apache.conf:8`
- Apache `LimitRequestBody` is 8 MiB. `apache.conf:10`
- Apache directory listing and MultiViews are off. `apache.conf:13`
- `php.ini` sets `enable_post_data_reading = Off`: every body stays in `php://input`. `php.ini:5`
- `php.ini` sets `post_max_size = 8M`, which `ValidatePostSize` answers 413 above. `php.ini:7`
- `php.ini` sets `display_errors = Off`, `log_errors = On`, `expose_php = Off`. `php.ini:10`, `php.ini:11`, `php.ini:12`
- Compose droplets service builds `examples/frameworks/Dockerfile` from the repository root. `docker-compose.yml:8`, `docker-compose.yml:9`
- Compose droplets service publishes `127.0.0.1:${DROPLETS_PORT:-8000}`. `docker-compose.yml:11`
- Compose droplets service `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and this host's `WEB_URL`. `docker-compose.yml:14`
- Compose shop service builds `examples/shop/Dockerfile` and only exposes 8300. `docker-compose.yml:21`, `docker-compose.yml:23`
- Compose shop demo login is `admin` / `droplets`. `docker-compose.yml:26`, `docker-compose.yml:27`
- Shop service `SHOP_SECRET` and `DROPLETS_SECRET` are required from the environment (`${VAR:?…}`), no default. `docker-compose.yml:28`, `docker-compose.yml:30`
- Compose shop `DROPLETS_TRUSTED_ORIGINS` is this host's `WEB_URL`. `docker-compose.yml:32`
- Compose web service publishes `127.0.0.1:${WEB_PORT:-8013}:80`. `docker-compose.yml:37`
- Compose web service environment: `DROPLETS_INTERNAL_URL`, `DROPLETS_PUBLIC_URL`, `SHOP_INTERNAL_URL`, `SHOP_PUBLIC_URL`. `docker-compose.yml:39`, `docker-compose.yml:42`
- `config/services.php` reads `SHOP_INTERNAL_URL` (default `http://localhost:8300`), `SHOP_PUBLIC_URL` (default `http://localhost:8013`), `DROPLETS_INTERNAL_URL` and `DROPLETS_PUBLIC_URL` (default `http://localhost:8000`). `config/services.php:11`, `config/services.php:13`, `config/services.php:18`, `config/services.php:19`
- Routes load outside the `web` middleware group (`withRouting(using: …)`, `Route::group([])`). `bootstrap/app.php:10`, `bootstrap/app.php:14`
- Global middleware is `ValidatePathEncoding` and `ValidatePostSize` only. `bootstrap/app.php:20`
- Proxied paths, every method (`Route::any`): `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*`. `routes/web.php:9`, `routes/web.php:12`
- Pages: `/`, `/gallery`, `/product/{slug}`, `/cart`, `/login`, `/admin`, `GET` and `HEAD` only (`Route::get`). `routes/web.php:16`, `routes/web.php:18`, `routes/web.php:22`
- Basic page droplets: `client`, `ssr-hydrate`, `ssr-nohydrate`, with `who` defaulting to `Laravel`. `app/Http/Controllers/HomeController.php:14`, `app/Http/Controllers/HomeController.php:23`
- Basic fragment fetch sends `accept: text/html` and `x-droplet-location: services.droplets.public_url`, never follows a redirect, timeout 5 s. `app/Http/Controllers/HomeController.php:27`, `app/Http/Controllers/HomeController.php:28`, `app/Http/Controllers/HomeController.php:29`
- Basic page pastes only a 2xx or 500 `text/html` answer; anything else renders an inline `<p class="error">`. `app/Http/Controllers/HomeController.php:41`, `app/Http/Controllers/HomeController.php:43`
- Basic page loads `<DROPLETS_PUBLIC_URL>/index.js`. `resources/views/index.blade.php:7`
- Droplets server's `cors: true` (the Svelte example) lets the basic page load droplets cross-origin. `../../frameworks/svelte/droplets.config.ts:16`
- Shop `x-droplet-location` is the origin of `services.shop.public_url`, never the request's Host. `app/Shop.php:72`, `app/Shop.php:74`
- Shop client: no redirect followed, connect timeout 5 s, Guzzle's cookie jar off, no `Expect: 100-continue`. `app/Shop.php:86`, `app/Shop.php:87`, `app/Shop.php:89`
- Shop proxy request headers allowlist: accept, accept-language, content-type, if-none-match, origin, referer, user-agent, x-droplet-props, x-droplets-build, plus `cookie` cut down to `cart_id` and `shop_admin`. `app/Shop.php:25`, `app/Shop.php:57`
- Shop query is parsed from `QUERY_STRING` as pairs: repeated keys and dotted names kept. `app/Shop.php:113`
- Shop `Set-Cookie` lines are parsed with `Cookie::fromString` onto the response; one that does not parse is logged and dropped. `app/Shop.php:157`
- Shop proxy refuses a path with a `.` or `..` segment, once decoded, with 400. `app/Shop.php:178`, `app/Http/Controllers/ShopProxyController.php:14`
- Shop proxy sends the method on the wire (`getRealMethod()`), not `X-HTTP-Method-Override` or `_method`. `app/Shop.php:198`
- Shop proxy forwards `getContent()` as the body for methods other than GET and HEAD. `app/Shop.php:210`
- Shop proxy concatenates the raw request target onto the shop's URL, so `//elsewhere` stays a path on the shop. `app/Shop.php:214`
- Shop proxy timeout is 15 s; an unreachable shop is 502 `The shop is unreachable.` `app/Shop.php:214`, `app/Shop.php:218`
- Shop proxy drops per-hop headers, content-encoding, content-length, and whatever `Connection` names. `app/Shop.php:41`, `app/Shop.php:224`
- Shop fragment fetch sends `accept: text/html`, the page URL as `Referer` and the browser's `Cookie` cut down to the shop's, all of a page's in one `Http::pool`, timeout 10 s. `app/Shop.php:252`, `app/Shop.php:257`, `app/Shop.php:261`
- Shop fragment is inserted only when it is 2xx or 500 and `text/html`. `app/Shop.php:282`
- Shop fragment that is not inserted becomes `<p class="shop-unavailable">`. `app/Shop.php:290`
- Shop product lookup reads `/droplets/product-page/_data?slug=`; an unknown product renders `not-found` with 404. `app/Shop.php:302`, `app/Http/Controllers/ShopController.php:26`
- Shop product name and category from `_data` are escaped with `{{ }}` in the breadcrumb. `resources/views/shop/product.blade.php:6`, `resources/views/shop/product.blade.php:7`
- Shop `Link` preloads kept: `preload` and `modulepreload` on this host's origin only. `app/Shop.php:335`
- Shop pages fetch `toast-center` and `shopping-cart?variant=badge` with every page. `app/Http/Controllers/ShopController.php:61`
- Shop pages answer a fragment's redirect with its own status and `Location`. `app/Http/Controllers/ShopController.php:62`, `app/Http/Controllers/ShopController.php:64`
- Shop pages send `Cache-Control: private, no-store` (Symfony writes it `no-store, private`) and every fragment's `Set-Cookie`. `app/Http/Controllers/ShopController.php:76`, `app/Http/Controllers/ShopController.php:77`
- Shop gallery passes the whole query to `product-filter` and `product-library`. `app/Http/Controllers/ShopController.php:19`
- Shop product page: `product-comments` gets `order`, `page`, `showing` and `productId`; `product-page` gets `slug` and `v`. `app/Http/Controllers/ShopController.php:28`, `app/Http/Controllers/ShopController.php:31`
- Shop cart page renders `shopping-cart?variant=inline`. `app/Http/Controllers/ShopController.php:41`
- Shop login page passes `next`; admin page passes `view` and `id`. `app/Http/Controllers/ShopController.php:46`, `app/Http/Controllers/ShopController.php:51`
- Shop layout loads `/shop.css` and `/index.js` from this origin, with speculation rules for `/product/*`. `resources/views/shop/layout.blade.php:7`, `resources/views/shop/layout.blade.php:11`, `resources/views/shop/layout.blade.php:12`
- Shop footer stack label is `Laravel 13`. `app/Shop.php:22`
- Feature tests: the proxy's headers, cookies, origin, body and method out; status, `Location`, cookies and no per-hop headers back; dot segments refused; 502; no cookie kept between visitors. `tests/Feature/ProxyTest.php:13`, `tests/Feature/ProxyTest.php:64`, `tests/Feature/ProxyTest.php:101`, `tests/Feature/ProxyTest.php:117`
- Feature tests: a page's fragment requests, only HTML pasted, a fragment's redirect and cookies passed on, an unknown product's 404, the product's name escaped, pages `GET` only. `tests/Feature/PagesTest.php:32`, `tests/Feature/PagesTest.php:51`, `tests/Feature/PagesTest.php:65`, `tests/Feature/PagesTest.php:81`, `tests/Feature/PagesTest.php:89`, `tests/Feature/PagesTest.php:103`
- `pnpm test:hosts laravel` tests `http://localhost:8013`. `../../../tests/hosts/run.mjs:71`, `../hosts.json`
- `examples/hosts/*` is outside the pnpm workspace. `../../../pnpm-workspace.yaml:5`

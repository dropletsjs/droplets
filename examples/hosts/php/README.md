# PHP

Plain PHP 8.3 on the official `php:8.3-apache` image: no framework, no
Composer, curl only (built into the image). Apache sends every path that is
not a file in `public/` to `public/index.php`; `public/` is the document
root, so `app/` is never served.

`/` fetches the Svelte example's three droplets at once (`curl_multi`), sends
`x-host` so the fragments point at the browser-facing origin, and prints
them into `app/views/index.php`, which loads `/index.js` once.

```bash
docker compose up --build
open http://localhost:8009
```

The browser loads each droplet's JavaScript from `http://localhost:8000`, a
different origin than the page, so the droplets server runs with `cors: true`.

## The shop demo

The same compose file runs the [shop example](../../shop) beside
the basic page: open http://localhost:8009/gallery (admin / droplets).
`app/shop.php` adds five pages (`/gallery`, `/product/<slug>`, `/cart`,
`/login`, `/admin`) that fetch the shop's fragments on the server, all of a
page's at once with `curl_multi` (`app/http.php`), into the templates under
`app/views/shop/`, and proxies `/index.js`, `/droplets/*` (fragments,
`_data`, form actions), `/assets/*` and `/api/*` to the shop under this
host's own origin, so its cookies (the cart, the admin session) are
first-party and nothing is cross-origin.

- `x-host` is `SHOP_PUBLIC_URL`, written out in the environment: never the
  request's Host. The shop lists that origin in `DROPLETS_TRUSTED_ORIGINS`.
- Fragment fetches forward the browser's `Cookie`, send the page URL
  (`REQUEST_URI`, query included) as `Referer`, never follow redirects, and
  insert only `text/html` answers; their `Set-Cookie` goes back with the
  page, their `Link` preloads into its `<head>`, a redirect is passed on.
- The proxy forwards an allowlist of the browser's headers and the body as
  it came, and answers with the shop's status, headers less the per-hop ones
  (and `Content-Length`/`Content-Encoding`, since curl decodes the body),
  every `Set-Cookie` and any redirect untouched.
- No curl handle has a cookie file, a cookie jar or a share handle, and each
  lives for one request: one visitor's cookies never ride along with
  another's.
- `php.ini` turns `enable_post_data_reading` off, so a multipart post (the
  admin's image upload) stays in `php://input` for the proxy instead of
  being parsed into `$_POST` and `$_FILES`.
- The layout's stylesheet is `public/shop.css`, the same file in every host.

Without Docker, with a droplets server on port 8000 and the shop on 8300
(`pnpm --filter @dropletsjs/example-shop build`, then `pnpm start` in
`examples/shop` with `DROPLETS_TRUSTED_ORIGINS=http://localhost:8009`), PHP's
built-in server works too:

```bash
php -d enable_post_data_reading=0 -S localhost:8009 -t public public/index.php
```

`SHOP_INTERNAL_URL` defaults to `http://localhost:8300`, `SHOP_PUBLIC_URL` to
`http://localhost:8009`.

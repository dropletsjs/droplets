`examples/hosts/laravel`: droplets and the shop demo embedded from Laravel 13 on PHP 8.5 and Apache, with Laravel's HTTP client and Blade.

## Rules

- The example is standalone: users copy this folder, so it depends on Packagist packages only (`composer.json`, `composer.lock`) and never on a path into `packages/` or the workspace.
  `docker-compose.yml` alone builds the droplets server and the shop from the repository root (`context: ../../..`).
- It is outside the pnpm workspace and has no `package.json`; Composer runs inside its Docker build, and the stack through its own Docker Compose file.
  Checked by: `pnpm-workspace.yaml`.
- The shop flow passes against `docker compose up --build`: gallery, cart, admin, no-JavaScript post, fresh visitor, edited product.
  Checked by: `pnpm test:hosts laravel` (`tests/hosts/run.mjs`, `tests/hosts/e2e/shop.spec.ts`).
- `x-droplet-location` is a public origin from the config (`services.shop.public_url`, `services.droplets.public_url`, read from `SHOP_PUBLIC_URL` and `DROPLETS_PUBLIC_URL`), never the request's Host.
  Checked by: `tests/hosts/test/location.test.ts`, `tests/Feature/ProxyTest.php`.
- `DROPLETS_TRUSTED_ORIGINS` of both the droplets server and the shop in `docker-compose.yml` lists this host's `WEB_URL`.
- The routes stay outside the `web` middleware group (no cookie encryption, session or CSRF check between the browser and the shop), and the global middleware reads no body before a route is chosen.
  Checked by: `tests/Feature/ProxyTest.php`, `tests/hosts/e2e/shop.spec.ts`.
- The proxy passes on an allowlist of request headers, the method on the wire and the body as it came, never follows a redirect, and returns the shop's status, its `303`s and every `Set-Cookie`, less the per-hop headers.
  Checked by: `tests/Feature/ProxyTest.php`, `tests/hosts/e2e/shop.spec.ts` ("without JavaScript, add to cart lands back on the host page").
- No request to the shop keeps cookies: Guzzle's jar is off (`'cookies' => false`) and only the visitor's own shop cookies are sent.
  Checked by: `tests/Feature/ProxyTest.php`, `tests/hosts/e2e/shop.spec.ts` ("a new visitor gets nobody else's cart or session").
- A path with a `.` or `..` segment, once decoded, never reaches the shop (400).
  Checked by: `tests/Feature/ProxyTest.php`.
- `enable_post_data_reading` stays off, so multipart posts reach the proxy in `php://input`.
- Only an HTML answer (2xx or 500) is inserted as a fragment, with `{!! !!}`; any other answer becomes a fixed note, and values from the shop go out through `{{ }}`.
  Checked by: `tests/Feature/PagesTest.php`.
- A page passes its fragments' `Set-Cookie` and a fragment's redirect on to the browser.
  Checked by: `tests/Feature/PagesTest.php`.
- The config is never cached in the image: it reads the environment compose gives the container.
- `public/shop.css` is the same file as every other host's shop layout; a change goes to all of them.
  Checked by: `tests/hosts/test/shop-css.test.ts`.
- Published ports bind to `127.0.0.1` only.
- `apps/docs/src/content/docs/integrate/hosts/laravel.mdx` states what this host does.
- A change to the host's logic comes with a feature test in `tests/Feature/` (`docker build --target test .`).
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

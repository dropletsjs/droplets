`examples/hosts/php`: droplets and the shop demo embedded from plain PHP 8.3 on Apache, with curl only.

## Rules

- The example is standalone: users copy this folder, so it uses PHP's bundled extensions only (no Composer) and never a path into `packages/` or the workspace.
  `docker-compose.yml` alone builds the droplets server and the shop from the repository root (`context: ../../..`).
- It is outside the pnpm workspace and has no `package.json`; it runs through its own Docker Compose stack.
  Checked by: `pnpm-workspace.yaml`.
- The shop flow passes against `docker compose up --build`: gallery, cart, admin, no-JavaScript post, fresh visitor, edited product.
  Checked by: `pnpm test:hosts php` (`tests/hosts/run.mjs`, `tests/hosts/e2e/shop.spec.ts`).
- `x-droplet-location` is a public origin written out in the environment (`SHOP_PUBLIC_URL`, `DROPLETS_PUBLIC_URL`), never the request's Host.
  Checked by: `tests/hosts/test/location.test.ts`.
- `DROPLETS_TRUSTED_ORIGINS` of both the droplets server and the shop in `docker-compose.yml` lists this host's `WEB_URL`.
- `public/` is the document root; `app/` is never served.
- The proxy passes on an allowlist of request headers and the body as it came, never follows a redirect, and returns the shop's `303`s and every `Set-Cookie` untouched.
  Checked by: `tests/hosts/e2e/shop.spec.ts` ("without JavaScript, add to cart lands back on the host page").
- No curl handle keeps cookies: no cookie file, jar or share handle, one request per handle, only the visitor's own `Cookie` sent.
  Checked by: `tests/hosts/e2e/shop.spec.ts` ("a new visitor gets nobody else's cart or session").
- `enable_post_data_reading` stays off, so multipart posts reach the proxy in `php://input`.
- Only an HTML answer (2xx or 500) is inserted as a fragment; any other answer becomes a fixed note, and values from the shop go out through `h()`.
- A page passes its fragments' `Set-Cookie` and a fragment's redirect on to the browser.
- `public/shop.css` is the same file as every other host's shop layout; a change goes to all of them.
  Checked by: `tests/hosts/test/shop-css.test.ts`.
- Published ports bind to `127.0.0.1` only.
- `apps/docs/src/content/docs/integrate/hosts/php.mdx` states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

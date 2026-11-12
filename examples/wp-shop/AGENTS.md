`examples/wp-shop`: the shop's droplets with WordPress holding the data, run behind `examples/hosts/wordpress`.

## Rules

- wp-shop is standalone: users copy it, so it depends only on published `@dropletsjs/*` packages and public tools at their published ranges (`^<version>`, the catalog's literal tool ranges; pnpm links the packages here), never on `@dropletsjs/shared` or a `../../` path. Only `Dockerfile` builds from the repository root, against the workspace packages.
  Checked by: `../../tests/packages/test/examples.test.ts`, `../../tests/hosts/test/standalone.test.ts`.
- wp-shop has no login of its own: the WordPress account is the admin, asserted by the plugin's signed `x-wp-shop-user`.
  Checked by: `test/unit.test.ts` ("x-wp-shop-user, the host-asserted identity"), `test/server.test.ts`.
- `x-wp-shop-user` is read in this order: size cap and shape, the MAC, then `JSON.parse`, own keys into a prototype-less object, each claim's type, then `exp`, method, path, `aud` and, on a write back, the body's SHA-256.
  Checked by: `test/unit.test.ts`.
- Each direction has its own secret, 32+ bytes: `WP_SHOP_HOST_SECRET` (WordPress → wp-shop) and `WP_SHOP_SERVICE_SECRET` (wp-shop → WordPress); equal values refuse both.
  Checked by: `test/unit.test.ts` ("the two secrets").
- Authorization lives in data: `product-admin` without an admin renders a `wp-login.php` link, an admin action answers `fail(401)`; `handle` never redirects.
  Checked by: `test/server.test.ts`.
- WordPress's answers are untrusted input: REST paths stay under `/wp-json/`, every answer is size-capped, timed out and schema-checked, images only from `WP_PUBLIC_URL`'s uploads.
  Checked by: `test/unit.test.ts` ("WordPress's REST answers").
- The build reads WordPress: the container builds at start, after WordPress answers.
  Checked by: `scripts/start.sh`, `../../tests/hosts/e2e/shop-wordpress.spec.ts` (`pnpm test:hosts wordpress`).
- The tests need no WordPress: they build against `test/mock-wordpress.ts`.
  Checked by: `pnpm test:example:wp-shop` in `pnpm check`.
- The droplets' UI and props follow `examples/shop`; a change to a shared droplet belongs in both, and in `../shop/CONTRACT.md`.
- No secret is committed or baked into an image: `.env.example` holds demo values only.
- A droplet uses one framework; `*.server.*` and `src/lib/server/` never reach a client bundle.
  Checked by: the plugin, in `vite build` and `vite dev`.
- A behaviour change comes with a test; a fix with a test that failed before it.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

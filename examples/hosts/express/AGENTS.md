`examples/hosts/express`: Express 5 as a droplets host (fragments fetched on the server, the shop demo behind a same-origin proxy), and a built droplets server mounted in one process.

## Rules

- The host app is standalone, since users copy it: it builds and runs from its own files and needs only the droplets servers' URLs in the environment. `docker-compose.yml` alone builds the droplets server and the shop from the repository root (`context: ../../..`).
- The host depends on published npm packages only, never on `packages/shared` or another workspace package; `src/server.js` talks to the droplets servers over HTTP.
  Checked by: `npm ci` from `package-lock.json` in `tests/hosts/typecheck.mjs`.
- It is outside the pnpm workspace: npm with its own `package-lock.json`, and Docker Compose (`docker-compose.yml`, `docker-compose.https.yml`).
- It typechecks with `pnpm typecheck:hosts express` from the repository root (`npm ci`, then `tsc --noEmit` with `checkJs`).
  Checked by: `tests/hosts/typecheck.mjs`.
- The shop flow passes against this compose stack with `pnpm test:hosts express`, and over https behind Caddy with `--https`.
  Checked by: `tests/hosts/e2e/shop.spec.ts`, run by `tests/hosts/run.mjs`.
- In `src/droplets.js` and `src/shop.js`, `x-droplet-location` is the configured public origin (`DROPLETS_PUBLIC_URL`, `SHOP_PUBLIC_URL`), never the request's Host; `src/embedded.js` sends none.
  Checked by: `tests/hosts/e2e/shop.spec.ts`, `tests/hosts/test/location.test.ts`.
- In `docker-compose.yml`, the droplets server's `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and this host's `WEB_URL`; the shop's lists `WEB_URL`. The https override makes the https URL both the host's `SHOP_PUBLIC_URL` and the shop's trusted origin.
  Checked by: `tests/hosts/e2e/shop.spec.ts`.
- The proxy forwards only the listed request headers, none that names a host, and passes `Set-Cookie`, redirects and bodies back untouched.
  Checked by: `tests/hosts/e2e/shop.spec.ts`.
- A shop page inserts a fragment only when it is a 2xx or 500 `text/html` answer.
- Published ports bind to `127.0.0.1` only.
- `public/shop.css` is the same file as the other hosts' `shop.css` (all but WordPress); a change goes to all of them.
  Checked by: `tests/hosts/test/shop-css.test.ts`.
- `apps/docs/src/content/docs/integrate/hosts/express.mdx` states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

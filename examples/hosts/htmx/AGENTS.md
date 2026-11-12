`examples/hosts/htmx`: two static pages served by nginx whose droplets htmx swaps in, one from the Svelte example cross-origin, one from the shop behind nginx's proxy.

## Rules

- The host app is standalone, since users copy it: it builds and runs from its own files and needs only the droplets servers' URLs in the environment. `docker-compose.yml` alone builds the droplets server and the shop from the repository root (`context: ../../..`).
- The pages depend on one published npm package, `htmx.org`, pinned in `package.json` and `package-lock.json`; never on `packages/shared` or a workspace package.
- It is outside the pnpm workspace: npm (in the `Dockerfile` only), nginx and Docker Compose (`docker-compose.yml`).
- The htmx flow passes against this compose stack with `pnpm test:hosts htmx`.
  Checked by: `tests/hosts/e2e/htmx.spec.ts`, run by `tests/hosts/run.mjs`.
- No server renders the pages: `html/` is static, and every droplet arrives by an htmx request or an element the page writes.
  Checked by: `tests/hosts/e2e/htmx.spec.ts`.
- nginx sends `x-droplet-location` set to `SHOP_PUBLIC_URL`, never the request's Host, and clears `Forwarded` and `X-Forwarded-*` toward the shop.
  Checked by: `tests/hosts/e2e/htmx.spec.ts`, `tests/hosts/test/location.test.ts`.
- In `docker-compose.yml`, the droplets server's and the shop's `DROPLETS_TRUSTED_ORIGINS` list this site's `WEB_URL`.
  Checked by: `tests/hosts/e2e/htmx.spec.ts`.
- The droplets server runs with `cors: true` and the pages set htmx's `selfRequestsOnly: false`, so htmx reaches it cross-origin, preflight included; `html/droplet-origins.js` then allows only the origins the page loads an `/index.js` from.
  Checked by: `tests/hosts/e2e/htmx.spec.ts` ("the droplets server answers htmx's preflight", "htmx reaches the droplets servers' origins and no other").
- The shop's proxy sends the shop only its own cookies (`cart_id`, `shop_admin`), by a `map` in `nginx.conf`.
- Every page has the same `<head>`, with one `/index.js` per droplets server, since a boosted link swaps only the `<body>`.
  Checked by: `tests/hosts/e2e/htmx.spec.ts`.
- Each element that receives a droplet has `hx-boost="false"`, so the droplet's forms stay its own.
  Checked by: `tests/hosts/e2e/htmx.spec.ts`.
- The pages name the droplets server as `http://localhost:8000`; `sub_filter` in `nginx.conf` rewrites it to `DROPLETS_PUBLIC_URL`.
- Published ports bind to `127.0.0.1` only.
- `apps/docs/src/content/docs/integrate/hosts/htmx.mdx` states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

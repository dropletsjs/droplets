`examples/hosts/htmx`: static pages served by nginx whose droplets htmx swaps in: the shop behind nginx's proxy, moving as one page, and the Svelte example's droplets cross-origin.

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
- The droplets server runs with `cors: true` and the Svelte page sets htmx's `selfRequestsOnly: false`, so htmx reaches it cross-origin, preflight included; `html/droplet-origins.js` then allows only the origins the page loads an `/index.js` from.
  Checked by: `tests/hosts/e2e/htmx.spec.ts` ("the droplets server answers htmx's preflight", "htmx reaches the droplets server's origin and no other").
- The shop's proxy sends the shop only its own cookies (`cart_id`, `shop_admin`), by a `map` in `nginx.conf`.
- Every shop page (`gallery`, `product`, `login`, `admin`) has the same `<head>`, header and footer, since a navigation swaps `<main>` alone; the shop's `/index.js` loads once, and the header, the cart badge and the toasts stay.
  Checked by: `tests/hosts/test/htmx.test.ts`, `tests/hosts/e2e/htmx.spec.ts` ("the shop, one page swapped by htmx").
- A shop page's `<main>` has `hx-history-elt` and `hx-disinherit="*"`: Back and Forward restore it alone, each droplet's request swaps into its own element, and a droplet's forms stay its own; links in it go by htmx through `html/shop.js`.
  Checked by: `tests/hosts/test/htmx.test.ts`, `tests/hosts/e2e/htmx.spec.ts`.
- A droplet's props from the page's URL are the names its element lists (`data-page-query`, `data-page-slug`), added by `html/shop.js`; every page works on a direct load, and without JavaScript keeps its header, links and footer.
  Checked by: `tests/hosts/e2e/htmx.spec.ts` ("a shop page loaded directly", "a shop page without JavaScript").
- `html/shop.css` is the shop hosts' shared file, unchanged; this site's own styles are `html/site.css`.
  Checked by: `tests/hosts/test/shop-css.test.ts`.
- The Svelte page (`html/index.html`) loads that server's `/index.js` alone and boosts nothing; it and the shop link to each other with full page loads.
  Checked by: `tests/hosts/test/htmx.test.ts`.
- The Svelte page names its droplets server as `http://localhost:8000`; `sub_filter` in `nginx.conf` rewrites it to `DROPLETS_PUBLIC_URL`.
- Published ports bind to `127.0.0.1` only.
- `apps/docs/src/content/docs/integrate/hosts/htmx.mdx` states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

`examples/hosts/static`: one static HTML page on nginx whose script asks the shop's droplets server for its fragments from the browser, on that server's own origin, with no proxy.

## Rules

- The host is standalone, since users copy it: it builds and runs from its own files and needs only the droplets server's URL. `docker-compose.yml` alone builds the shop from the repository root (`context: ../../..`).
- No server code and no package: `html/` is static, nginx serves it and proxies nothing; every droplet arrives by a `fetch` from the browser or an element the page writes.
  Checked by: `tests/hosts/e2e/shop.spec.ts` (the shop flow, run against this page), `tests/hosts/e2e/static.spec.ts`.
- Nothing here sends `x-droplet-location`: the browser reaches the droplets server on its own origin.
  Checked by: `tests/hosts/test/location.test.ts` (`NONE`).
- `html/shop.js` reads the droplets server's URL from the page's `/index.js` tag, sends every request with `credentials: "include"` and the page's whole URL as `Referer`, inserts only an HTML answer (a 2xx, a 500 or a 504), never follows a redirect, and shows a fixed note for anything else.
  Checked by: `tests/hosts/e2e/static.spec.ts` ("a page loaded directly takes its props from its URL", "an old version in the URL renders the product live").
- The page names its droplets server as `http://localhost:8000`; `sub_filter` in `nginx.conf` rewrites it to `DROPLETS_PUBLIC_URL`.
- In `docker-compose.yml`, the shop's `DROPLETS_TRUSTED_ORIGINS` is this page's `WEB_URL`; the shop's own `cors` answers that origin by name with credentials, never `*`.
  Checked by: `tests/hosts/e2e/static.spec.ts` ("the shop answers this page's origin with credentials, and no other").
- `html/shop.css` is the shop hosts' shared file, unchanged; this page's own styles are `html/site.css`.
  Checked by: `tests/hosts/test/shop-css.test.ts`.
- The shared shop flow and this page's own checks pass against this compose stack with `pnpm test:hosts static`.
  Checked by: `tests/hosts/e2e/shop.spec.ts`, `tests/hosts/e2e/static.spec.ts`, run by `tests/hosts/run.mjs`.
- Published ports bind to `127.0.0.1` only.
- `apps/docs/src/content/docs/integrate/hosts/static.mdx` states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

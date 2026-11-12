`examples/hosts/fastapi`: a FastAPI app that fetches droplet fragments with `httpx` into Jinja templates and proxies the shop demo under its own origin.

## Rules

- The host app is standalone, since users copy it: it builds and runs from its own files and needs only the droplets servers' URLs in the environment. `docker-compose.yml` alone builds the droplets server and the shop from the repository root (`context: ../../..`).
- The host depends on published PyPI packages only (`requirements.txt`), never on `packages/shared` or a workspace package; it talks to the droplets servers over HTTP.
- It is outside the pnpm workspace: pip with its own `requirements.txt`, and Docker Compose (`docker-compose.yml`).
- The shop flow passes against this compose stack with `pnpm test:hosts fastapi`.
  Checked by: `tests/hosts/e2e/shop.spec.ts`, run by `tests/hosts/run.mjs`.
- `x-droplet-location` is the configured public origin (`DROPLETS_PUBLIC_URL`, `SHOP_PUBLIC_URL`), never the request's Host.
  Checked by: `tests/hosts/e2e/shop.spec.ts`, `tests/hosts/test/location.test.ts`.
- In `docker-compose.yml`, the droplets server's `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and this host's `WEB_URL`; the shop's lists `WEB_URL`.
  Checked by: `tests/hosts/e2e/shop.spec.ts`.
- The proxy forwards only the listed request headers, none that names a host, and passes `Set-Cookie`, redirects and bodies back untouched.
  Checked by: `tests/hosts/e2e/shop.spec.ts`.
- The shared `httpx.AsyncClient` keeps no cookies and follows no redirects: each visitor's `Cookie` is forwarded as it came.
  Checked by: `tests/hosts/e2e/shop.spec.ts` ("a new visitor gets nobody else's cart or session").
- A shop page inserts a fragment only when it is a 2xx or 500 `text/html` answer, as `Markup`.
- Published ports bind to `127.0.0.1` only.
- `static/shop.css` is the same file as the other hosts' `shop.css` (all but WordPress); a change goes to all of them.
  Checked by: `tests/hosts/test/shop-css.test.ts`.
- `apps/docs/src/content/docs/integrate/hosts/fastapi.mdx` states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

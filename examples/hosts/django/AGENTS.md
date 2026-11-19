`examples/hosts/django`: a Django project that fetches droplet fragments with `httpx` into Django templates and proxies the shop demo under its own origin.

## Rules

- The host app is standalone, since users copy it: it builds and runs from its own files and needs only the droplets servers' URLs in the environment. `docker-compose.yml` alone builds the droplets server and the shop from the repository root (`context: ../../..`).
- The host depends on published PyPI packages only (`requirements.txt`), never on `packages/shared` or a workspace package; it talks to the droplets servers over HTTP.
- It is outside the pnpm workspace: pip with its own `requirements.txt`, and Docker Compose (`docker-compose.yml`).
- The shop flow passes against this compose stack with `pnpm test:hosts django`.
  Checked by: `tests/hosts/e2e/shop.spec.ts`, run by `tests/hosts/run.mjs`.
- The host's own logic (the proxy's refusals, the headers it sends, what it pastes and passes back) has a test in `shop/tests.py`, run by `python manage.py test` and by the Docker build.
  Checked by: `shop/tests.py`, `Dockerfile`.
- `x-droplet-location` is the configured public origin (`DROPLETS_PUBLIC_URL`, `SHOP_PUBLIC_URL` in `config/settings.py`), never the request's Host; nothing calls `request.get_host()` or `build_absolute_uri()`.
  Checked by: `tests/hosts/e2e/shop.spec.ts`, `tests/hosts/test/location.test.ts`.
- In `docker-compose.yml`, the droplets server's `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and this host's `WEB_URL`; the shop's lists `WEB_URL`.
  Checked by: `tests/hosts/e2e/shop.spec.ts`.
- The proxy forwards only the listed request headers, none that names a host, and passes `Set-Cookie`, redirects and bodies back untouched.
  Checked by: `shop/tests.py`, `tests/hosts/e2e/shop.spec.ts`.
- The proxy settles the route, the method, the path's segments and the body's size before it reads the body.
  Checked by: `shop/tests.py`.
- The shared `httpx.Client` keeps no cookies and follows no redirects: each visitor's `Cookie` is forwarded as it came.
  Checked by: `tests/hosts/e2e/shop.spec.ts` ("a new visitor gets nobody else's cart or session").
- A shop page inserts a fragment only when it is a 2xx, 500 or 504 `text/html` answer, with `mark_safe`; every other string goes through the template's escaping or `format_html`.
  Checked by: `shop/tests.py`.
- Published ports bind to `127.0.0.1` only.
- `shop/static/shop.css` is the same file as the other hosts' `shop.css` (all but WordPress); a change goes to all of them.
  Checked by: `tests/hosts/test/shop-css.test.ts`.
- `apps/docs/src/content/docs/integrate/hosts/django.mdx` states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

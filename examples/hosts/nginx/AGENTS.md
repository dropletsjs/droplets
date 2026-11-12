`examples/hosts/nginx`: droplets and the shop demo embedded by nginx alone, with Server Side Includes and a reverse proxy; no application code.

## Rules

- The example is standalone: users copy this folder, so it holds only nginx config and static pages, never a path into `packages/` or the workspace.
  `docker-compose.yml` alone builds the droplets server and the shop from the repository root (`context: ../../..`).
- It is outside the pnpm workspace and has no `package.json`; it runs through its own Docker Compose stack.
  Checked by: `pnpm-workspace.yaml`.
- The shop flow passes against `docker compose up --build` on port 8081: gallery, cart, admin, no-JavaScript post, fresh visitor, edited product.
  Checked by: `pnpm test:hosts nginx` (`tests/hosts/run.mjs`, `tests/hosts/e2e/shop.spec.ts`).
- Each droplets server learns its public URL from the `x-droplet-location` nginx sends (`DROPLETS_PUBLIC_URL`, `SHOP_PUBLIC_URL`), trusted through its `DROPLETS_TRUSTED_ORIGINS`; every proxied location replaces a client's `x-droplet-location` and clears `Forwarded` and `X-Forwarded-Host`/`-Proto`/`-Prefix`.
- `DROPLETS_TRUSTED_ORIGINS` of both the droplets server and the shop in `docker-compose.yml` lists the origin of the pages that embed them.
- The proxy passes bodies, `303`s and every `Set-Cookie` on untouched.
  Checked by: `tests/hosts/e2e/shop.spec.ts` ("without JavaScript, add to cart lands back on the host page").
- Each fragment subrequest carries only the visitor's own `Cookie`.
  Checked by: `tests/hosts/e2e/shop.spec.ts` ("a new visitor gets nobody else's cart or session").
- Only a fragment (2xx or a 500) is pasted into a page; every other error becomes a fixed note.
- Values from the shop's JSON are echoed with `encoding="entity"` (text) or `encoding="url"` (query).
- An unknown product is a 404 and an old `v` a 302, decided by the `auth_request` before the page renders.
  Checked by: `tests/hosts/e2e/shop.spec.ts` ("an edited product's page is never stale").
- `shop/shop.css` is the same file as every other host's shop layout; a change goes to all of them.
  Checked by: `tests/hosts/test/shop-css.test.ts`.
- Published ports bind to `127.0.0.1` only.
- `apps/docs/src/content/docs/integrate/hosts/nginx.mdx` states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

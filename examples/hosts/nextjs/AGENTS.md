`examples/hosts/nextjs`: droplets and the shop demo embedded in a Next.js App Router app, with server components and route handlers.

## Rules

- The example is standalone: users copy this folder, so it depends on published packages only, never on `packages/shared` or a workspace path.
  `docker-compose.yml` alone builds the droplets server and the shop from the repository root (`context: ../../..`).
  Checked by: `pnpm typecheck:hosts nextjs` (`npm ci` from this folder's own lockfile).
- It is outside the pnpm workspace, with its own `package-lock.json` and Docker Compose stack.
  Checked by: `pnpm-workspace.yaml`.
- `npm run typecheck` passes from a clean `npm ci`.
  Checked by: `pnpm typecheck:hosts nextjs` (`tests/hosts/typecheck.mjs`), in CI.
- The shop flow passes against `docker compose up --build`: gallery, cart, admin, no-JavaScript post, fresh visitor, edited product.
  Checked by: `pnpm test:hosts nextjs` (`tests/hosts/run.mjs`, `tests/hosts/e2e/shop.spec.ts`).
- `x-droplet-location` is a public origin written out in the environment (`SHOP_PUBLIC_URL`, `DROPLETS_PUBLIC_URL`), never the request's Host.
- `DROPLETS_TRUSTED_ORIGINS` of both the droplets server and the shop in `docker-compose.yml` lists this host's `WEB_URL`.
- The proxy passes on an allowlist of request headers, never follows a redirect, and returns the shop's `303`s and every `Set-Cookie` untouched.
  Checked by: `tests/hosts/e2e/shop.spec.ts` ("without JavaScript, add to cart lands back on the host page").
- Each request to the shop carries only the visitor's own `Cookie`: nothing keeps cookies between requests.
  Checked by: `tests/hosts/e2e/shop.spec.ts` ("a new visitor gets nobody else's cart or session").
- Only an HTML answer (2xx or 500) is inserted as a fragment; any other answer becomes a fixed note.
- Modules that read server environment or fetch the shop import `server-only`.
- `public/shop.css` is the same file as every other host's shop layout; a change goes to all of them.
- Published ports bind to `127.0.0.1` only.
- `apps/docs/src/content/docs/integrate/hosts/nextjs.mdx` states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

`examples/hosts/react-vite`: droplets and the shop demo embedded in a React single-page app built with Vite, fetched from the browser.

## Rules

- The example is standalone: users copy this folder, so it depends on published packages only, never on `packages/shared` or a workspace path.
  `docker-compose.yml` alone builds the droplets server and the shop from the repository root (`context: ../../..`).
  Checked by: `pnpm typecheck:hosts react-vite` (`npm ci` from this folder's own lockfile).
- It is outside the pnpm workspace, with its own `package-lock.json` and Docker Compose stack.
  Checked by: `pnpm-workspace.yaml`.
- `npm run typecheck` passes from a clean `npm ci`.
  Checked by: `pnpm typecheck:hosts react-vite` (`tests/hosts/typecheck.mjs`), in CI.
- The shop flow passes against `docker compose up --build`: gallery, cart, admin, fresh visitor, edited product; the no-JavaScript test skips this host.
  Checked by: `pnpm test:hosts react-vite` (`tests/hosts/run.mjs`, `tests/hosts/e2e/shop.spec.ts`).
- `x-droplet-location` is `SHOP_PUBLIC_URL`, written out, never the request's Host; `Forwarded` and `X-Forwarded-*` are removed. The image's nginx and the Vite proxy keep the same rule.
- `DROPLETS_TRUSTED_ORIGINS` of both the droplets server and the shop in `docker-compose.yml` lists this host's `WEB_URL`.
- The app's own build output stays under `/app/` (`build.assetsDir`), so `/assets/*` is the shop's.
- The proxy passes bodies, `303`s and every `Set-Cookie` on untouched; the browser sends the shop's cookies itself.
  Checked by: `tests/hosts/e2e/shop.spec.ts` ("a new visitor gets nobody else's cart or session").
- Fragments are fetched with `redirect: "manual"`; only an HTML answer (2xx or 500) is inserted.
- React owns a droplet's wrapper element and never renders inside it; the custom element owns its children.
- `src/shop/shop.css` is the same file as every other host's shop layout; a change goes to all of them.
- Published ports bind to `127.0.0.1` only.
- `apps/docs/src/content/docs/integrate/hosts/react-vite.mdx` states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

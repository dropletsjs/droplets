`examples/hosts/sveltekit`: a SvelteKit host that embeds droplets and the shop demo over HTTP, run with Docker Compose.

## Rules

- The app is standalone, since users copy it: it installs from its own `package.json` and `package-lock.json` and needs only the URLs in the environment.
  `docker-compose.yml` builds the droplets server and the shop from the repository root (`context: ../../..`).
- It depends on no `@dropletsjs/*` package and never on `packages/shared`: it talks to the droplets server over HTTP only.
- It is outside the pnpm workspace, with its own toolchain (npm) and Docker Compose.
  Checked by: `pnpm-workspace.yaml` (no `examples/hosts/*` entry).
- The app typechecks on its own install, `npm ci` then `npm run typecheck`, warnings included.
  Checked by: `pnpm typecheck:hosts sveltekit` (`tests/hosts/typecheck.mjs`).
- Code that talks to the droplets server or the shop lives in `*.server.ts` files, so it never reaches the browser.
  Checked by: SvelteKit's own server-only module check in `vite build`.
- `x-droplet-location` is the public origin from the environment (`DROPLETS_PUBLIC_URL`, `SHOP_PUBLIC_URL`), never the request's Host.
  Checked by: `pnpm test:hosts sveltekit` (`tests/hosts/e2e/shop.spec.ts`: a post without JavaScript lands back on the host page).
- `DROPLETS_TRUSTED_ORIGINS` of the droplets server and of the shop in `docker-compose.yml` lists this host's origin (`WEB_URL`), and `ORIGIN` is that same origin.
  Checked by: `pnpm test:hosts sveltekit`.
- The shop's browser requests (`/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*`) go through the proxy in `handle`, which forwards only its listed request headers and passes `Set-Cookie` back untouched.
  Checked by: `pnpm test:hosts sveltekit`.
- A page inserts only a 2xx or 500 `text/html` fragment; a fragment's redirect is answered, never followed.
  Checked by: `pnpm test:hosts sveltekit`.
- `src/lib/shop.server.ts` stays framework-free (Web `Request` and `Response` only); SvelteKit code lives in `shop-page.server.ts`, `hooks.server.ts` and the routes.
- The host flow is the shop flow against this compose stack.
  Checked by: `pnpm test:hosts sveltekit` (`tests/hosts/run.mjs`, `tests/hosts/e2e/shop.spec.ts`); needs Docker.
- Published ports bind to `127.0.0.1` only.
- `static/shop.css` is the same file as the other hosts' `shop.css` (all but WordPress); a change goes to all of them.
- `apps/docs/src/content/docs/integrate/hosts/sveltekit.mdx` states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

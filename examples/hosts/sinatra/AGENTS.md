`examples/hosts/sinatra`: a Sinatra host that embeds droplets and the shop demo over HTTP, run with Docker Compose.

## Rules

- The app is standalone, since users copy it: `app.rb`, `shop.rb` and `views/` need only the `Gemfile`'s gems and the URLs in the environment.
  `docker-compose.yml` builds the droplets server and the shop from the repository root (`context: ../../..`).
- It depends on no `@dropletsjs/*` package and never on `packages/shared`: it talks to the droplets server over HTTP only.
- It is outside the pnpm workspace, with its own toolchain (Bundler) and Docker Compose.
  Checked by: `pnpm-workspace.yaml` (no `examples/hosts/*` entry).
- `x-droplet-location` is the public origin from the environment (`DROPLETS_PUBLIC_URL`, `SHOP_PUBLIC_URL`), never the request's Host.
  Checked by: `pnpm test:hosts sinatra` (`tests/hosts/e2e/shop.spec.ts`: a post without JavaScript lands back on the host page).
- `DROPLETS_TRUSTED_ORIGINS` of the droplets server and of the shop in `docker-compose.yml` lists this host's origin (`WEB_URL`).
  Checked by: `pnpm test:hosts sinatra`.
- The shop's browser requests (`/index.js`, `/droplets/*`, `/assets/*`, `/api/*`) go through this host's same-origin proxy, which forwards only its listed request headers and passes `Set-Cookie` back untouched.
  Checked by: `pnpm test:hosts sinatra`.
- A page inserts only a 2xx or 500 `text/html` fragment; a fragment's redirect is answered, never followed.
  Checked by: `pnpm test:hosts sinatra`.
- The host flow is the shop flow against this compose stack.
  Checked by: `pnpm test:hosts sinatra` (`tests/hosts/run.mjs`, `tests/hosts/e2e/shop.spec.ts`); needs Docker.
- Published ports bind to `127.0.0.1` only.
- `public/shop.css` is the same file as the other hosts' `shop.css` (all but WordPress); a change goes to all of them.
- `apps/docs/src/content/docs/integrate/hosts/sinatra.mdx` states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

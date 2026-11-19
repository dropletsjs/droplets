`examples/hosts/rails`: a Rails host that embeds droplets and the shop demo over HTTP, with no database, run with Docker Compose.

## Rules

- The app is standalone, since users copy it: `app/`, `config/` and `test/` need only the `Gemfile`'s gems and the URLs in the environment.
  `docker-compose.yml` builds the droplets server and the shop from the repository root (`context: ../../..`).
- It depends on no `@dropletsjs/*` package and never on `packages/shared`: it talks to the droplets server over HTTP only.
- It is outside the pnpm workspace, with its own toolchain (Bundler, inside Docker) and Docker Compose.
  Checked by: `pnpm-workspace.yaml` (no `examples/hosts/*` entry), `tests/hosts/test/standalone.test.ts`.
- `x-droplet-location` is the public origin from the environment (`DROPLETS_PUBLIC_URL`, `SHOP_PUBLIC_URL`), never the request's Host; nothing here calls `redirect_to` with a path, which prefixes the request's Host.
  Checked by: `pnpm test:hosts rails` (`tests/hosts/e2e/shop.spec.ts`: a post without JavaScript lands back on the host page), `tests/hosts/test/location.test.ts`, `test/integration/shop_test.rb`.
- `DROPLETS_TRUSTED_ORIGINS` of the droplets server and of the shop in `docker-compose.yml` lists this host's origin (`WEB_URL`).
  Checked by: `pnpm test:hosts rails`.
- The shop's browser requests (`/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*`) go through `ShopProxy`, a Rack endpoint routed before any body is read, which refuses a dot segment and a body over 4 MB, forwards only its listed request headers and passes `Set-Cookie` back untouched.
  Checked by: `test/integration/shop_test.rb`, `pnpm test:hosts rails`.
- Nothing reads a request body before the route is chosen: `Rack::MethodOverride` stays out of the middleware.
  Checked by: `test/integration/shop_test.rb` ("passes the body on").
- A page inserts only a 2xx, 500 or 504 `text/html` fragment, the one string marked `html_safe`; a fragment's redirect is answered, never followed.
  Checked by: `test/integration/shop_test.rb`, `pnpm test:hosts rails`.
- The host flow is the shop flow against this compose stack.
  Checked by: `pnpm test:hosts rails` (`tests/hosts/run.mjs`, `tests/hosts/e2e/shop.spec.ts`); needs Docker.
- The image runs `bin/rails test` as it builds; a host change with logic of its own comes with a test in `test/`.
  Checked by: `Dockerfile`.
- Published ports bind to `127.0.0.1` only.
- `public/shop.css` is the same file as the other hosts' `shop.css` (all but WordPress); a change goes to all of them.
  Checked by: `tests/hosts/test/shop-css.test.ts`.
- `apps/docs/src/content/docs/integrate/hosts/rails.mdx` states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

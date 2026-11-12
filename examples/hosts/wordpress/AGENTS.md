`examples/hosts/wordpress`: WordPress with the Droplets Embed plugin, embedding droplets and the `examples/wp-shop` shop over HTTP, run with Docker Compose.

## Rules

- The plugin is standalone, since users copy it: `plugin/droplets-embed` needs only WordPress, PHP and the settings in the environment.
  `docker-compose.yml` builds the droplets server and wp-shop from the repository root (`context: ../../..`) and the init image from `examples/shop`'s data.
- It depends on no `@dropletsjs/*` package and never on `packages/shared`: it talks to the droplets server and wp-shop over HTTP only.
- It is outside the pnpm workspace, with its own toolchain (the WordPress and WP-CLI images) and Docker Compose; it has no `package.json`, so `pnpm typecheck:hosts` skips it.
  Checked by: `pnpm-workspace.yaml` (no `examples/hosts/*` entry), `tests/hosts/typecheck.mjs`.
- `x-droplet-location` is the public origin from the environment (`DROPLETS_PUBLIC_URL`, `SHOP_PUBLIC_URL`), never the request's Host.
  Checked by: `pnpm test:hosts wordpress` (`tests/hosts/e2e/shop.spec.ts`, `tests/hosts/e2e/shop-wordpress.spec.ts`).
- `DROPLETS_TRUSTED_ORIGINS` of the droplets server and of wp-shop in `docker-compose.yml` lists this site's origin (`WEB_URL`).
  Checked by: `pnpm test:hosts wordpress`.
- The browser reaches wp-shop only through the plugin's same-origin proxy (`/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*`), which sends only the `cart_id` cookie and its listed headers, never a browser's `x-wp-shop-user`.
  Checked by: `pnpm test:hosts wordpress`.
- `x-wp-shop-user` is signed by the plugin alone, for a logged-in user who can `manage_options`, for one method and path, 60 seconds; an unsafe request gets one only with this site's `Origin`.
  Checked by: `tests/hosts/e2e/shop-wordpress.spec.ts` (Origin, capability and logged-out cases).
- `x-wp-shop-service` logs a request in only on `POST /wp-json/wp/v2/products/<id>`, checked again after routing; on any other route WordPress's own login applies.
  Checked by: `tests/hosts/e2e/wordpress-service.spec.ts`.
- An assertion's MAC is compared in constant time (`hash_equals`) before its payload is decoded with plain `json_decode`, with a size cap and typed claims.
- `WP_SHOP_HOST_SECRET` and `WP_SHOP_SERVICE_SECRET` are 32+ bytes and differ; the compose file requires each from the environment and gives both services the same variable, never a value of its own.
  Checked by: `tests/hosts/e2e/wordpress-service.spec.ts` (each secret one required variable in `docker-compose.yml`, on both services; the host secret does not sign writes).
- The `product-admin` droplet renders only on the Shop screen in wp-admin; no public page, `/admin` included, carries it, and no public droplet is in wp-admin.
  Checked by: `tests/hosts/e2e/shop-wordpress.spec.ts`.
- A page inserts only a 2xx or 500 `text/html` fragment, after WordPress's content filters; a fragment's redirect is answered, never followed.
  Checked by: `pnpm test:hosts wordpress`.
- The catalogue's category slugs match `examples/wp-shop`'s `src/lib/categories.ts`; the catalogue is imported from `examples/shop`'s mock data.
- The host flow runs only when named.
  Checked by: `pnpm test:hosts wordpress` (`tests/hosts/run.mjs`, `byName`); needs Docker.
- Published ports bind to `127.0.0.1` only.
- `apps/docs/src/content/docs/integrate/wordpress.mdx` (the WordPress tutorial) states what this host does.
- Comments explain a non-obvious why.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

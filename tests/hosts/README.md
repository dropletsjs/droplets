# tests/hosts

The host examples in [`examples/hosts`](../../examples/hosts), end to end:
each host's compose stack started, a flow run against it in Chromium,
recorded, and the stack taken down. Nine hosts run the shop flow; WordPress
and htmx (whose shop moves as one page) have flows of their own and run only
by name. `typecheck.mjs`
type-checks every Node host without Docker, and `test/` holds the static
checks over `examples/` (vitest, no Docker): the shop's `shop.css` copies
the same, every host's `x-droplet-location` from its environment, every
example standing on its own, htmx's shop pages sharing their frame.

```bash
pnpm test:hosts                     # the nine shop flows, one at a time
pnpm test:hosts express nginx       # some, by id (the folder's name)
pnpm test:hosts wordpress           # the WordPress showcase, with wp-shop
pnpm test:hosts htmx                # the htmx shop and the Svelte page
pnpm typecheck:hosts [host…]        # npm ci + npm run typecheck per Node host, no Docker
pnpm --filter @dropletsjs/tests-hosts test   # the static checks in test/, no Docker (pnpm test:integration runs them)
```

The folder's own scripts are the same: `pnpm --filter @dropletsjs/tests-hosts
e2e` (`node run.mjs`) and `typecheck:hosts` (`node typecheck.mjs`).

## Details

### What it needs

- Docker with Compose. Each stack builds its images from the repository
  root (the packages are compiled inside the image), so no `dist/` is needed
  for the flows.
- Chromium for Playwright, once:
  `pnpm --filter @dropletsjs/tests-hosts exec playwright install chromium`.
- `ffmpeg` on the `PATH` to keep recordings as MP4 (without it the WebM is
  kept, with a warning) and for `--docs`.
- `--tour` runs `djs sync` in `examples/shop`, so it needs the packages
  built (`pnpm build`).
- The ports of the compose files free, or a `HOSTS_PORT_BASE`.

### Settings

`run.mjs` reads the repository's gitignored `.env.local` first, when there
is one; a variable already set in the environment wins.
[`.env.example`](../../.env.example) lists the repository's variables; the
ones for this suite are `HOSTS_PORT_BASE` and the stacks' secrets
(`SHOP_SECRET`, `DROPLETS_SECRET`, `WP_SHOP_HOST_SECRET`,
`WP_SHOP_SERVICE_SECRET`), which the runner sets to random values for a run
when they are unset. Compose runs on whatever Docker the
environment points at: the Docker CLI reads its own `DOCKER_HOST` or
`DOCKER_CONTEXT`, from the environment or `.env.local`, and the runner adds
nothing of its own.

`HOSTS_PORT_BASE` moves every published port into one block of a hundred:
the droplets server on the base, each host on the base plus its default
port's last two digits (express, 8003: base + 3).

### Flags

| Flag | Effect |
|---|---|
| `--https` | express behind Caddy (`docker-compose.https.yml`) on `https://127-0-0-1.sslip.io:8443`; express only |
| `--docs` | also writes the docs' copies to `apps/docs/public/hosts/` (720p MP4 within 1 MB, WebP screenshots), paced as a person; needs ffmpeg |
| `--human` | paced as a person, without the docs' copies |
| `--tour` | also records the droplet tour (`e2e/tour.spec.ts`) first; not for htmx |
| `--keep` | leaves the last stack running |

### A run, per host

1. `docker compose -p droplets-<host> up --build -d` in `examples/hosts/<host>`.
2. Waits up to 10 minutes until the host's page (`/gallery`, or htmx's `/`)
   answers 200 and `/droplets/product-filter` through the host returns a
   `<djs-shop` fragment (htmx: also `/droplets/ssr-hydrate` on the droplets
   server).
3. `playwright test` with `HOST_NAME` and `HOST_URL` set; htmx runs only
   `e2e/htmx.spec.ts`, the others every spec, each skipping itself where it
   does not belong.
4. `docker compose down -v --remove-orphans`, also on SIGINT and SIGTERM.

Recordings land in `recordings/<host>.mp4` and screenshots in
`recordings/<host>/` (gitignored); nothing is uploaded.

### The flows

- `e2e/shop.spec.ts` (every host but WordPress and htmx): products into the
  cart, a product page, the admin login, that product's stock set to 0, the
  cart and the product page saying "Out of stock"; plus a toast on add to
  cart, a post without JavaScript (not on react-vite, an SPA), no shared
  cart or session between visitors, and a product page never stale after
  an edit.
- `e2e/nginx-basic.spec.ts` (nginx only): the basic page on the droplets
  port hydrates through the proxy, which passes `/env.js` and `/index.css`
  on with `/index.js`.
- `e2e/shop-wordpress.spec.ts`: the WordPress flow (a comment posted, the
  cart, WordPress's login, wp-admin's Shop screen for the stock, a logout),
  a comment without JavaScript, and the Shop screen's refusals.
- `e2e/wordpress-service.spec.ts`: the signed `x-wp-shop-service` header
  logs in the product write and nowhere else.
- `e2e/htmx.spec.ts`: the shop as one page (a card's link and the header's
  swap `<main>` alone, the header and `/index.js` kept, the URL pushed), the
  product's enhanced form, the login's Post/Redirect/Get, a card asked for
  once revealed, Back and Forward from htmx's history; each page loaded
  directly with its URL's props, a page without JavaScript; the Svelte
  example's droplets swapped in from another origin, the refused third
  origin, and the preflight.
- `e2e/tour.spec.ts`: the droplet tour, run alone with `TOUR=1` by `--tour`.

### Static checks (`test/`)

vitest over the sources of `examples/`, run by `pnpm test:integration` and
so by `pnpm check`, with no Docker:

- `test/shop-css.test.ts`: every host that runs the shop has a `shop.css`,
  the same file in all of them; WordPress's is its own, for the Twenty
  Twenty-Five theme's presets, as its header says.
- `test/htmx.test.ts`: htmx's four shop pages share their `<head>`, header
  and footer, swap `<main>` alone (`hx-target`, `hx-select`,
  `hx-history-elt`, `hx-disinherit`), ask for every droplet from inside it
  on their own origin and write the cart badge and the toasts outside it;
  nginx gives each its path; the Svelte page loads its server's `/index.js`
  alone and boosts nothing.
- `test/location.test.ts`: per host, the files that send
  `x-droplet-location`, the value each such line may give it (an origin
  from `SHOP_PUBLIC_URL` or `DROPLETS_PUBLIC_URL`, or nginx's `${…}`), the
  line that reads it from the environment, and no read of the request's
  own `Host` (in JavaScript, Python, Ruby, PHP, nginx or IIS terms) in
  those files.
- `test/standalone.test.ts`: `examples/shop`, `examples/wp-shop`, each
  `examples/frameworks/*` and each `examples/hosts/*` has no `file:` or
  `link:` dependency, no relative import or `tsconfig` `extends` reaching
  above its own folder. The ranges themselves (`@dropletsjs/*` at
  `^<version>`, the tools at the catalog's) are
  [`tests/packages`](../packages)' `examples.test.ts`.

### Type check

`typecheck.mjs` takes every `examples/hosts/*` with a `package.json` and a
`typecheck` script (or the hosts named), runs `npm ci --no-audit --no-fund`
then `npm run typecheck` in each, with pnpm's `npm_config_*` variables and
`node_modules/.bin` folders removed from the environment, so each host uses
its own install. The hosts are outside the pnpm workspace, so
`pnpm typecheck` never sees them.

## Facts

- `HOSTS` maps each host id to its URL: express 8003, nginx 8081, fastapi 8001, sinatra 8002, php 8009, wordpress 8008, react-vite 8004, astro 8005, sveltekit 8006, nextjs 8007, htmx 8010. `run.mjs:57`
- Hosts run only by name (`byName`): wordpress and htmx. `run.mjs:63`, `run.mjs:70`
- No host named, or `all`: every host without `byName`. `run.mjs:89`
- htmx runs `e2e/htmx.spec.ts` only, waits on `/`, reaches the droplets server on `http://localhost:8000`. `run.mjs:68`
- `--https` is set up for express only, on `https://127-0-0-1.sslip.io:8443`. `run.mjs:79`, `run.mjs:122`
- Flags: `--https`, `--docs`, `--human`, `--tour`, `--keep`; any other flag or host exits 2. `run.mjs:86`
- `HOSTS_PORT_BASE` must be an integer from 1024 to 65435. `run.mjs:98`
- `HOSTS_PORT_BASE` sets `WEB_PORT`, `WEB_URL`, `DROPLETS_PORT`, `DROPLETS_URL` for compose: host on base plus its default port mod 100, droplets on the base. `run.mjs:105`
- `.env.local` at the repository root is loaded first; set variables win. `run.mjs:49`, `../../packages/shared/env.ts:4`
- `SHOP_SECRET`, `DROPLETS_SECRET`, `WP_SHOP_HOST_SECRET` and `WP_SHOP_SERVICE_SECRET` get 32 random bytes (hex) for the run when unset or empty; set ones win. `run.mjs:53`
- Ready check: the host page answers 200 and `/droplets/product-filter` through the host returns `<djs-shop`, polled every 2 s for up to 10 minutes. `run.mjs:138`, `run.mjs:263`
- Compose project name is `droplets-<host>`, run in `examples/hosts/<host>`. `run.mjs:235`
- Compose env is the process environment plus the port variables; the runner sets no Docker variables. `run.mjs:238`
- Stack start: `docker compose up --build -d`. `run.mjs:260`
- Stack teardown: `docker compose down -v --remove-orphans` after each host, unless `--keep` on the last. `run.mjs:287`
- Stack teardown on SIGINT or SIGTERM. `run.mjs:242`
- A failed start prints the last 40 lines of `docker compose logs`. `run.mjs:285`
- Playwright runs with `HOST_NAME` and `HOST_URL`; `--docs`/`--human` add `RECORD_PACE=human`. `run.mjs:229`, `run.mjs:279`
- `--tour` runs the tour first with `TOUR=1`; htmx has none. `run.mjs:266`
- `--docs` video copy: 720p H.264, CRF 28 up to 34 to stay within 1 MB. `run.mjs:173`, `run.mjs:179`
- `--docs` screenshots: WebP at quality 78, in `apps/docs/public/hosts/<host>/`. `run.mjs:208`
- Shop flow screenshots: `1-gallery`, `2-cart`, `3-admin`, `4-out-of-stock`. `run.mjs:82`
- `--https` sets `NODE_TLS_REJECT_UNAUTHORIZED=0` for the run. `run.mjs:258`
- Exit code 1 when any host fails; a table of host, result and video is printed. `run.mjs:297`
- Playwright: one worker, no retries, 180 s per test, 15 s per expect. `playwright.config.ts:13`
- Playwright `baseURL` is `HOST_URL`; HTTPS errors are ignored for Caddy's internal CA. `playwright.config.ts:23`
- `tour.spec.ts` runs only with `TOUR`, and is ignored otherwise. `playwright.config.ts:11`
- Recordings directory is `recordings/`, gitignored. `e2e/record.ts:8`, `../../.gitignore:53`
- `HOST_NAME` defaults to `host`; `RECORD_PACE=human` paces as a person. `e2e/record.ts:11`, `e2e/record.ts:18`
- Recordings convert WebM to MP4 with ffmpeg; without it the WebM is kept with a warning. `e2e/record.ts:66`
- `shop.spec.ts` main flow is skipped on WordPress. `e2e/shop.spec.ts:76`
- `shop.spec.ts` no-JavaScript post is skipped on react-vite. `e2e/shop.spec.ts:247`
- Shop admin login is `admin` / `droplets`, session cookie `shop_admin`, `httpOnly`. `e2e/shop.spec.ts:29`, `e2e/shop.spec.ts:35`
- `nginx-basic.spec.ts` runs only for nginx, against `DROPLETS_URL` (default `http://localhost:8080`): `/env.js` and `/index.css` answer 200 through the proxy and the three droplets hydrate as their mode says. `e2e/nginx-basic.spec.ts:9`, `e2e/nginx-basic.spec.ts:12`, `e2e/nginx-basic.spec.ts:22`, `e2e/nginx-basic.spec.ts:30`
- `shop-wordpress.spec.ts` and `wordpress-service.spec.ts` run only for wordpress. `e2e/shop-wordpress.spec.ts:13`, `e2e/wordpress-service.spec.ts:16`
- WordPress Shop screen is `/wp-admin/admin.php?page=droplets-shop`. `e2e/wordpress.ts:8`
- `wordpress-service.spec.ts` signs with the run's `WP_SHOP_SERVICE_SECRET` and `WP_SHOP_HOST_SECRET` from the environment, after checking `examples/hosts/wordpress/docker-compose.yml` requires each from that one variable on both services. `e2e/wordpress-service.spec.ts:20`
- `htmx.spec.ts` runs only for htmx; droplets server from `DROPLETS_URL`, default `http://localhost:8000`. `e2e/htmx.spec.ts:13`, `e2e/htmx.spec.ts:16`
- `htmx.spec.ts` checks an `hx-get` to a third origin is refused with `htmx:invalidPath` and sends nothing. `e2e/htmx.spec.ts:290`, `e2e/htmx.spec.ts:301`
- `htmx.spec.ts` flow: a card's link and the header's links swap `<main>` alone, the header element and the window kept, `/index.js` requested once. `e2e/htmx.spec.ts:43`, `e2e/htmx.spec.ts:61`
- `htmx.spec.ts` flow: Back restores the admin's `<main>` from htmx's history, Forward the gallery, the header the same throughout. `e2e/htmx.spec.ts:158`, `e2e/htmx.spec.ts:168`
- `htmx.spec.ts` loads `/gallery?category=mugs&ignored=1` and `/product/<slug>` directly: the droplets get only the props they list; an unknown product gets the unavailable note. `e2e/htmx.spec.ts:178`
- `htmx.spec.ts` turns JavaScript off: a shop page keeps its header, links and `<noscript>` note. `e2e/htmx.spec.ts:204`
- htmx screenshots: `1-gallery`, `2-added`, `3-login`, `4-lazy`. `run.mjs:80`
- `htmx.test.ts` compares the four shop pages with title, `aria-current` and `<main>`'s content taken out. `test/htmx.test.ts:18`, `test/htmx.test.ts:29`
- `htmx.test.ts` expects each shop page's body and `<main>` attributes, one module script (`/index.js`) and `/shop.js`. `test/htmx.test.ts:34`
- `htmx.test.ts` expects every `hx-get` of a shop page inside `<main>` and on `/droplets/`. `test/htmx.test.ts:47`
- `htmx.test.ts` expects the Svelte page to load only `http://localhost:8000/index.js` and no `hx-boost`. `test/htmx.test.ts:76`
- Tour reads each droplet's renderer from `djs sync` (`pnpm exec djs sync`). `e2e/droplet-facts.ts:61`
- Typecheck covers every `examples/hosts/*` with a `package.json` and a `typecheck` script. `typecheck.mjs:18`
- Typecheck of a named host without a `typecheck` script exits 2. `typecheck.mjs:25`
- Typecheck strips `npm_config_*` and `node_modules/.bin` from the environment. `typecheck.mjs:36`
- Typecheck runs `npm ci --no-audit --no-fund`, then `npm run typecheck`. `typecheck.mjs:46`
- CI runs the typecheck in its own job, no Docker. `../../.github/workflows/ci.yml:100`
- Scripts: `e2e` is `node run.mjs`, `test` is `vitest run`, `typecheck:hosts` is `node typecheck.mjs`. `package.json:8`
- vitest runs `test/**/*.test.ts` in the Node environment. `vitest.config.ts:5`
- `shop-css.test.ts` finds every `shop.css` under `examples/hosts` outside `node_modules`, expects one per shop host and WordPress, and all but WordPress's byte-equal to express's. `test/shop-css.test.ts:14`, `test/shop-css.test.ts:22`, `test/shop-css.test.ts:38`
- `shop-css.test.ts` expects WordPress's `shop.css` to name the theme (Twenty Twenty-Five) and use `--wp--preset--` values. `test/shop-css.test.ts:44`
- `location.test.ts` lists per host the files that send `x-droplet-location`, the value a line may give it and the environment read it comes from. `test/location.test.ts:24`
- `location.test.ts` fails on a host-header read (`.headers.host`, `req.hostname`, `request.host`, `HTTP_HOST`, `$host`, `$http_host`, `{HTTP_HOST}` and the like) in those files, comments left out. `test/location.test.ts:95`, `test/location.test.ts:123`
- `standalone.test.ts` takes `examples/shop`, `examples/wp-shop`, every `examples/frameworks/*` and every `examples/hosts/*` as a root, skipping `node_modules`, `dist`, `build`, `.next`, `.svelte-kit`, `.astro`, `.venv`, `.droplets`, `.tmp` and `__pycache__`. `test/standalone.test.ts:16`, `test/standalone.test.ts:27`
- `standalone.test.ts` fails on a `file:` or `link:` range in any `package.json`, a relative import resolving above the root in a `.js`/`.ts`/`.svelte`/`.vue`/`.astro` file, or a relative `extends` above the root in a `tsconfig*.json`. `test/standalone.test.ts:49`, `test/standalone.test.ts:62`, `test/standalone.test.ts:72`
- Root `test:hosts` and `typecheck:hosts` run this folder's scripts. `../../package.json:40`

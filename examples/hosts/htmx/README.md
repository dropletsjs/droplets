# htmx

Two static pages whose droplets htmx swaps in. A droplets server answers
`GET /droplets/<id>` with an HTML fragment, which is what htmx asks a server
for; `/index.js`, loaded once, makes every droplet element live, including
the ones htmx puts in later. No server renders these pages: nginx serves
them and proxies the shop.

```bash
docker compose up --build
open http://localhost:8010        # the Svelte example's droplets, cross-origin
open http://localhost:8010/shop   # the shop's droplets, same origin
```

Compose starts three services: `droplets` (the Svelte example, published on
http://localhost:8000, which the browser reaches directly), `shop` (reached
only through nginx) and `web` (nginx, on http://localhost:8010). Every port
is published on `127.0.0.1`.

## Details

### The pages

| Page | What it shows |
| ---- | ------------- |
| `/` (`html/index.html`) | The Svelte example's three droplets, from its own origin (`:8000`, cross-origin): `ssr-hydrate` on `load`, `client` on a click, `ssr-nohydrate` once `revealed`. |
| `/shop` (`html/shop.html`) | The shop's droplets through nginx's proxy (same origin), in a body with `hx-boost`: the product page's enhanced form, the login's plain form (Post/Redirect/Get) and a product card asked for once revealed. The cart badge is an element the page writes itself (`data-droplet`, `data-params`). |

### What it needs

- **Cross-origin**: `<meta name="htmx-config" content='{"selfRequestsOnly": false}'>`
  for htmx (its check runs before `htmx:validateUrl`, so a listener cannot
  allow an origin while it is on), then `html/droplet-origins.js`, an
  `htmx:validateUrl` listener that allows the origins the page loads an
  `/index.js` from and refuses any other; and `cors` on the droplets server
  (the Svelte example has `cors: true`), which answers the preflight htmx's
  `HX-*` headers cause.
- **One `/index.js` per droplets server**, in the `<head>`: the Svelte
  example's from `http://localhost:8000`, the shop's from this origin.
- **`hx-boost`**: `hx-boost="false"` on each element that receives a
  droplet, so the droplet's forms stay its own; and the same `<head>` on
  every page, since a boosted link swaps only the `<body>`.

### nginx (`nginx.conf`)

- Serves `html/` and `vendor/htmx.min.js`; `/shop` is `shop.html`.
- Proxies `/index.js`, `/env.js`, `/index.css`, `/droplets/`, `/assets/` and `/api/` to the shop as
  they are (bodies, `Set-Cookie`, redirects), so its cookies are this
  origin's own; the browser's `Cookie` goes through cut down to the shop's
  own `cart_id` and `shop_admin` (a `map`). `x-droplet-location` is
  `SHOP_PUBLIC_URL`, written out,
  never the request's Host, and the forwarded headers a client could use to
  name another host (`Forwarded`, `X-Forwarded-Host`, `X-Forwarded-Proto`,
  `X-Forwarded-Prefix`) are cleared. The browser's `Referer` goes through:
  the shop reads the page, and a form's result in its query, from it.
- The file is a template (the nginx image's `/etc/nginx/templates/`):
  `SHOP_PUBLIC_URL` and `DROPLETS_PUBLIC_URL` are filled in at start. The
  pages are written for the default ports; `sub_filter` rewrites
  `http://localhost:8000` in them to `DROPLETS_PUBLIC_URL`.

### htmx itself

`htmx.org` from npm, pinned in `package.json` and `package-lock.json`. The
`Dockerfile` installs it with `npm ci` and copies `dist/htmx.min.js` into
the nginx image.

### Environment

| Variable | Service | Default in compose |
|---|---|---|
| `SHOP_PUBLIC_URL` | web | `${WEB_URL:-http://localhost:8010}` |
| `DROPLETS_PUBLIC_URL` | web | `${DROPLETS_URL:-http://localhost:8000}` |
| `DROPLETS_TRUSTED_ORIGINS` | droplets | this site's URL |
| `DROPLETS_TRUSTED_ORIGINS` | shop | this site's URL |

`WEB_PORT`, `WEB_URL`, `DROPLETS_PORT` and `DROPLETS_URL` move the published
ports and public URLs; `tests/hosts/run.mjs` sets them for
`HOSTS_PORT_BASE`.

### Checks

From the repository root: `pnpm test:hosts htmx` runs
`tests/hosts/e2e/htmx.spec.ts` (only by name, not in the default set): the
three swaps, boosted navigation, both shop forms, the lazy card, htmx's
history restore and the droplets server's answer to htmx's preflight. There
is no code to typecheck. The guide's page:
[htmx](https://dropletsjs.dev/integrate/hosts/htmx/).

## Facts

- Web service publishes `127.0.0.1:${WEB_PORT:-8010}:80`. `docker-compose.yml:41`
- Droplets service publishes `127.0.0.1:${DROPLETS_PORT:-8000}:8000`; the browser reaches it directly. `docker-compose.yml:14`
- Droplets service builds `examples/frameworks/Dockerfile` from the repository root (the Svelte example by default). `docker-compose.yml:12`, `../../frameworks/Dockerfile:24`
- Droplets service `DROPLETS_TRUSTED_ORIGINS` is `WEB_URL`. `docker-compose.yml:17`
- Droplets server (Svelte example) has `cors: true`. `../../frameworks/svelte/droplets.config.ts:16`
- Shop service builds `examples/shop/Dockerfile` and only exposes 8300, unpublished. `docker-compose.yml:24`, `docker-compose.yml:26`
- Shop demo login is `admin` / `droplets` (demo values only). `docker-compose.yml:29`, `docker-compose.yml:30`
- Shop service `DROPLETS_SECRET` is a demo value that signs a Post/Redirect/Get form result. `docker-compose.yml:33`
- Shop service `DROPLETS_TRUSTED_ORIGINS` is `WEB_URL`. `docker-compose.yml:35`
- Web env `SHOP_PUBLIC_URL` is `${WEB_URL:-http://localhost:8010}`. `docker-compose.yml:43`
- Web env `DROPLETS_PUBLIC_URL` is `${DROPLETS_URL:-http://localhost:8000}`. `docker-compose.yml:44`
- Dockerfile installs htmx with `npm ci --ignore-scripts` on `node:24-alpine`. `Dockerfile:5`, `Dockerfile:8`
- Dockerfile serves with `nginx:1.27-alpine`. `Dockerfile:10`
- Dockerfile installs `nginx.conf` as the template `default.conf.template`. `Dockerfile:11`
- Dockerfile copies `html/` to the web root and `htmx.min.js` to `vendor/`. `Dockerfile:12`, `Dockerfile:13`
- htmx version is `htmx.org` 2.0.11, pinned. `package.json:7`
- Package has only `dependencies`, no `typecheck` script, so `pnpm typecheck:hosts` skips it. `package.json:6`, `../../../tests/hosts/typecheck.mjs:32`
- nginx upstream `shop` is `shop:8300`. `nginx.conf:9`
- nginx listens on 80 with `absolute_redirect off`. `nginx.conf:22`, `nginx.conf:24`
- nginx `sub_filter` rewrites `http://localhost:8000` to `DROPLETS_PUBLIC_URL` in HTML, every occurrence. `nginx.conf:31`, `nginx.conf:32`, `nginx.conf:33`
- nginx `/shop` serves `shop.html`. `nginx.conf:39`, `nginx.conf:40`
- nginx proxies `/index.js`, `/env.js`, `/index.css`, `/droplets/`, `/assets/`, `/api/` to the shop. `nginx.conf:52`, `nginx.conf:53`
- nginx sends the shop only `cart_id` and `shop_admin`, from the `$shop_cookie` map. `nginx.conf:14`, `nginx.conf:54`
- nginx `x-droplet-location` is `SHOP_PUBLIC_URL`, never the request's Host. `nginx.conf:55`
- nginx clears `Forwarded`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Prefix` toward the shop. `nginx.conf:56`, `nginx.conf:59`
- Index page sets htmx `selfRequestsOnly: false`. `html/index.html:11`
- Index page loads `/vendor/htmx.min.js`. `html/index.html:12`
- Index page loads the Svelte example's `/index.js` from `http://localhost:8000`. `html/index.html:16`
- Index page loads the shop's `/index.js` from this origin. `html/index.html:18`
- Index page body has `hx-boost="true"`. `html/index.html:21`
- Index page `ssr-hydrate?who=htmx` is swapped in on `load`. `html/index.html:33`, `html/index.html:34`
- Index page `client?who=Ana` is swapped into `#on-click` on a click. `html/index.html:41`, `html/index.html:42`
- Index page `ssr-nohydrate?who=htmx` is swapped in once `revealed`. `html/index.html:49`, `html/index.html:50`
- Index page loads `/droplet-origins.js` after the module scripts: an `htmx:validateUrl` listener that allows this origin and the origins the page loads an `/index.js` from, no other. `html/index.html:19`, `html/droplet-origins.js:6`, `html/droplet-origins.js:13`
- Shop page head is the same as the index page's. `html/shop.html:8`, `html/shop.html:12`
- Shop page body has `hx-boost="true"`. `html/shop.html:16`
- Shop page cart badge is a `<djs-shop data-droplet="shopping-cart" data-params='{"variant":"badge"}'>` the page writes. `html/shop.html:20`
- Shop page `product-page?slug=clay-cylinder-mug` loads in an `hx-boost="false"` section. `html/shop.html:28`, `html/shop.html:29`
- Shop page `login?next=/shop` loads in an `hx-boost="false"` section. `html/shop.html:36`, `html/shop.html:37`
- Shop page `product-card?slug=speckled-temple-cup` loads once `revealed`, in an `hx-boost="false"` section. `html/shop.html:45`, `html/shop.html:47`
- Host test runs only by name, with `e2e/htmx.spec.ts` instead of the shop flow, at `http://localhost:8010`. `../../../tests/hosts/run.mjs:68`, `../../../tests/hosts/run.mjs:70`, `../../../tests/hosts/run.mjs:71`
- Host test waits for the droplets server's `/droplets/ssr-hydrate` on `DROPLETS_URL` too. `../../../tests/hosts/run.mjs:74`, `../../../tests/hosts/run.mjs:145`
- Host test checks an `hx-get` to a third origin is refused (`htmx:invalidPath`) and no request goes out. `../../../tests/hosts/e2e/htmx.spec.ts:163`, `../../../tests/hosts/e2e/htmx.spec.ts:183`
- Host test checks the preflight answers 204, `access-control-allow-origin: *`, and echoes the `hx-*` headers. `../../../tests/hosts/e2e/htmx.spec.ts:193`, `../../../tests/hosts/e2e/htmx.spec.ts:203`

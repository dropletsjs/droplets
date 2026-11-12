# htmx

Static pages whose droplets htmx swaps in. A droplets server answers
`GET /droplets/<id>` with an HTML fragment, which is what htmx asks a server
for; `/index.js`, loaded once, makes every droplet element live, including
the ones htmx puts in later. No server renders these pages: nginx serves
them and proxies the shop.

```bash
docker compose up --build
open http://localhost:8010/gallery  # the shop, one page swapped by htmx
open http://localhost:8010          # the Svelte example's droplets, cross-origin
```

Set `SHOP_SECRET` and `DROPLETS_SECRET` first (32 or more random characters
each, `openssl rand -hex 32`), in the environment or a `.env` file beside
`docker-compose.yml`: compose refuses to start without them. `pnpm test:hosts`
generates its own for a run.

Compose starts three services: `droplets` (the Svelte example, published on
http://localhost:8000, which the browser reaches directly), `shop` (reached
only through nginx) and `web` (nginx, on http://localhost:8010). Every port
is published on `127.0.0.1`.

## Details

### The pages

| Page | File | What it shows |
| ---- | ---- | ------------- |
| `/gallery` | `html/gallery.html` | The shop's hero, the filter and the library (the page's `q`, `category`, `sort`, `onSale`, `page`), and a product card asked for once revealed. |
| `/product/<slug>` | `html/product.html` | The product page (its form enhanced), then its comments, asked for with the product's id. |
| `/login` | `html/login.html` | The login droplet (`next`): a plain form, Post/Redirect/Get. |
| `/admin` | `html/admin.html` | The admin (`view`, `id`), behind the login. |
| `/` | `html/index.html` | The Svelte example's three droplets, from its own origin (`:8000`, cross-origin): `ssr-hydrate` on `load`, `client` on a click, `ssr-nohydrate` once `revealed`. |

The shop's pages look like every other shop host's: the same `shop.css`,
the header with Gallery, Admin and the cart badge, the footer with the
stack. `site.css` adds the placeholders, the featured card and the
Svelte page's look.

### The shop as one page

- **`<main>` alone.** The `<body>` of every shop page has `hx-boost="true"`,
  `hx-target="main"`, `hx-select="main"` and `hx-swap="outerHTML
  show:window:top"`: a link fetches the whole next page and only its
  `<main>` replaces this one, the URL pushed. The header, the cart badge
  and the toasts (elements the page writes itself: `data-droplet`,
  `data-droplet-props`) stay, and `/index.js` loads once.
- **Droplets inherit none of it.** `<main>` has `hx-disinherit="*"`, so a
  droplet's `hx-get` swaps into its own element and nothing in `<main>` is
  boosted: a droplet's forms stay its own (the product page's enhanced
  form, the login's plain one).
- **Links in `<main>`** go by htmx all the same, from `html/shop.js`: a
  droplet renders its links after htmx has looked (a hydrated library
  re-renders its cards), so a click listener sends any same-origin page link
  in `<main>` through `htmx.ajax` with the body's target, select and swap.
- **Back and Forward**: `hx-history-elt` on `<main>`, so htmx keeps and
  restores `<main>` alone, and asks for its droplets again; `shop.js`
  moves the nav's `aria-current` with the page.
- **Props from the URL.** A static page has no server to read its URL:
  `shop.js` adds the query parameters an element lists in
  `data-page-query` to its request, and the path's last segment as the
  prop `data-page-slug` names. The product page asks for `slug` only, not
  `v`: an old `v` answers a redirect to the host page, which htmx would
  paste in; without it the product renders live. The comments wait for the
  product (`hx-trigger="htmx:afterSettle from:#product"`) and take its id
  from the product's form (`hx-include`).
- **Errors.** htmx swaps a 2xx only; `shop.js` puts a fixed note where a
  droplet answered an error (an unknown product), and loads a page that
  answered one in full.
- **Direct loads and no JavaScript.** Each page is a whole file: a direct
  load works the same, and without JavaScript the header, links and footer
  are there with a note in `<main>`; the droplets need htmx.

### What the Svelte page needs

- **Cross-origin**: `<meta name="htmx-config" content='{"selfRequestsOnly": false}'>`
  for htmx (its check runs before `htmx:validateUrl`, so a listener cannot
  allow an origin while it is on), then `html/droplet-origins.js`, an
  `htmx:validateUrl` listener that allows the origins the page loads an
  `/index.js` from and refuses any other; and `cors` on the droplets server
  (the Svelte example has `cors: true`), which answers the preflight htmx's
  `HX-*` headers cause.
- **That server's `/index.js`**, from `http://localhost:8000`. The page
  boosts nothing: its link to the shop loads the shop in full, with its
  own head.

### nginx (`nginx.conf`)

- Serves `html/` and `vendor/htmx.min.js`; `/gallery`, `/product/<slug>`
  (a slug of `[a-z0-9]+(?:-[a-z0-9]+)*`), `/login` and `/admin` are the
  shop's pages, one file each.
- Proxies `/index.js`, `/env.js`, `/index.css`, `/droplets/`, `/assets/` and `/api/` to the shop as
  they are (bodies, `Set-Cookie`, redirects), so its cookies are this
  origin's own; the browser's `Cookie` goes through cut down to the shop's
  own `cart_id` and `shop_admin` (a `map`). `x-droplet-location` is
  `SHOP_PUBLIC_URL`, written out,
  never the request's Host, and the forwarded headers a client could use to
  name another host (`Forwarded`, `X-Forwarded-Host`, `X-Forwarded-Proto`,
  `X-Forwarded-Prefix`) are cleared. The browser's `Referer` goes through:
  the shop reads the page, and a form's result in its query, from it.
  Bodies up to 4 MB (admin image uploads).
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
shop as one page (a card's link and the header's swap `<main>` alone, the
header and `/index.js` kept), both shop forms, the lazy card, Back and
Forward, direct loads with the URL's props, a page without JavaScript, the
three Svelte swaps and the droplets server's answer to htmx's preflight.
`tests/hosts/test/htmx.test.ts` (no Docker) checks the shop pages' shared
head, header and footer and their attributes. There is no code to
typecheck. The guide's page:
[htmx](https://dropletsjs.dev/integrate/hosts/htmx/).

## Facts

- Web service publishes `127.0.0.1:${WEB_PORT:-8010}:80`. `docker-compose.yml:41`
- Droplets service publishes `127.0.0.1:${DROPLETS_PORT:-8000}:8000`; the browser reaches it directly. `docker-compose.yml:14`
- Droplets service builds `examples/frameworks/Dockerfile` from the repository root (the Svelte example by default). `docker-compose.yml:12`, `../../frameworks/Dockerfile:24`
- Droplets service `DROPLETS_TRUSTED_ORIGINS` is `WEB_URL`. `docker-compose.yml:17`
- Droplets server (Svelte example) has `cors: true`. `../../frameworks/svelte/droplets.config.ts:16`
- Shop service builds `examples/shop/Dockerfile` and only exposes 8300, unpublished. `docker-compose.yml:24`, `docker-compose.yml:26`
- Shop demo login is `admin` / `droplets` (demo values only). `docker-compose.yml:29`, `docker-compose.yml:30`
- Shop service `SHOP_SECRET` and `DROPLETS_SECRET` are required from the environment (`${VAR:?…}`), no default. `docker-compose.yml:31`, `docker-compose.yml:33`
- Shop service `DROPLETS_TRUSTED_ORIGINS` is `WEB_URL`. `docker-compose.yml:35`
- Web env `SHOP_PUBLIC_URL` is `${WEB_URL:-http://localhost:8010}`. `docker-compose.yml:43`
- Web env `DROPLETS_PUBLIC_URL` is `${DROPLETS_URL:-http://localhost:8000}`. `docker-compose.yml:44`
- Dockerfile installs htmx with `npm ci --ignore-scripts` on `node:24-alpine`. `Dockerfile:5`, `Dockerfile:8`
- Dockerfile serves with `nginx:1.27-alpine`. `Dockerfile:10`
- Dockerfile installs `nginx.conf` as the template `default.conf.template`. `Dockerfile:11`
- Dockerfile copies `html/` to the web root and `htmx.min.js` to `vendor/`. `Dockerfile:12`, `Dockerfile:13`
- htmx version is `htmx.org` 2.0.11, pinned. `package.json:7`
- Package has only `dependencies`, no `typecheck` script, so `pnpm typecheck:hosts` skips it. `package.json:6`, `../../../tests/hosts/typecheck.mjs:32`
- nginx upstream `shop` is `shop:8300`. `nginx.conf:9`, `nginx.conf:10`
- nginx listens on 80 with `absolute_redirect off`. `nginx.conf:23`, `nginx.conf:25`
- nginx `sub_filter` rewrites `http://localhost:8000` to `DROPLETS_PUBLIC_URL` in HTML, every occurrence. `nginx.conf:32`, `nginx.conf:33`, `nginx.conf:34`
- nginx `/gallery`, `/login` and `/admin` serve `gallery.html`, `login.html`, `admin.html`. `nginx.conf:43`, `nginx.conf:49`, `nginx.conf:52`
- nginx `/product/<slug>` serves `product.html` for a slug matching `[a-z0-9]+(?:-[a-z0-9]+)*`, any other path a 404. `nginx.conf:46`
- nginx proxies `/index.js`, `/env.js`, `/index.css` (the names anchored: `/index.jsx` is a page), `/droplets/`, `/assets/`, `/api/` to the shop. `nginx.conf:65`
- nginx sends the shop only `cart_id` and `shop_admin`, from the `$shop_cookie` map. `nginx.conf:15`, `nginx.conf:67`
- nginx `x-droplet-location` is `SHOP_PUBLIC_URL`, never the request's Host. `nginx.conf:68`
- nginx clears `Forwarded`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Prefix` toward the shop. `nginx.conf:69`, `nginx.conf:72`
- Host test runs only by name, with `e2e/htmx.spec.ts` instead of the shop flow, at `http://localhost:8010`. `../../../tests/hosts/run.mjs:68`, `../../../tests/hosts/run.mjs:70`, `../../../tests/hosts/run.mjs:71`
- Host test waits for the droplets server's `/droplets/ssr-hydrate` on `DROPLETS_URL` too. `../../../tests/hosts/run.mjs:74`, `../../../tests/hosts/run.mjs:145`
- nginx takes request bodies up to 4 MB toward the shop. `nginx.conf:74`
- Shop pages are `gallery.html`, `product.html`, `login.html`, `admin.html`, with the same head, header and footer. `../../../tests/hosts/test/htmx.test.ts:29`
- Shop page head links `/shop.css` and `/site.css`, loads `/vendor/htmx.min.js`, the shop's `/index.js` from this origin and `/shop.js`. `html/gallery.html:9`, `html/gallery.html:10`, `html/gallery.html:14`, `html/gallery.html:15`
- Shop page body has `hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:window:top"`. `html/gallery.html:19`
- Shop page writes `<djs-shop data-droplet="toast-center">` first in the body and the cart badge `<djs-shop data-droplet="shopping-cart" data-droplet-props='{"variant":"badge"}'>` in the header. `html/gallery.html:22`, `html/gallery.html:29`
- Shop page `<main>` has `hx-history-elt` and `hx-disinherit="*"`, and a `<noscript>` note. `html/gallery.html:35`, `html/gallery.html:36`
- Shop footer links to `/` with `hx-boost="false"`. `html/gallery.html:65`
- Gallery asks for `product-filter` (`q category sort onSale`) and `product-library` (`q category sort onSale page`) on `load`. `html/gallery.html:44`, `html/gallery.html:48`
- Gallery asks for `product-card?slug=speckled-temple-cup` once `revealed`. `html/gallery.html:57`
- Product page asks for `product-page` with `slug` from the path, on `load`; no `v`. `html/product.html:42`
- Product page asks for `product-comments` after the product settles, with `productId` from its form and `order page showing` from the query. `html/product.html:47`, `html/product.html:48`, `html/product.html:49`, `html/product.html:50`
- Login page asks for `login` with `next`, on `load`. `html/login.html:40`
- Admin page asks for `product-admin` with `view` and `id`, on `load`. `html/admin.html:39`
- `shop.js` adds the page's query parameters an element lists in `data-page-query`, and the path's last segment as `data-page-slug`, to its request (`htmx:configRequest`). `html/shop.js:7`
- `shop.js` sends a plain click on a same-origin link in `<main>` through `htmx.ajax` from the body, URL pushed; not `/droplets/`, `/api/`, `/assets/`, `hx-boost="false"`, a target, a download or a same-page anchor. `html/shop.js:20`, `html/shop.js:25`, `html/shop.js:29`
- `shop.js` writes "This droplet is unavailable." where a droplet answered an error, and loads in full a page that did. `html/shop.js:34`
- `shop.js` moves the nav's `aria-current` on `htmx:pushedIntoHistory` and `htmx:historyRestore`. `html/shop.js:41`, `html/shop.js:47`, `html/shop.js:48`
- `shop.css` is the shop hosts' shared file; `site.css` is this site's own. `../../../tests/hosts/test/shop-css.test.ts:22`
- Svelte page sets htmx `selfRequestsOnly: false`. `html/index.html:10`
- Svelte page loads `/vendor/htmx.min.js` and the Svelte example's `/index.js` from `http://localhost:8000`, and no other `/index.js`. `html/index.html:11`, `html/index.html:15`
- Svelte page loads `/droplet-origins.js` after the module script: an `htmx:validateUrl` listener that allows this origin and the origins the page loads an `/index.js` from, no other. `html/index.html:16`, `html/droplet-origins.js:6`, `html/droplet-origins.js:13`
- Svelte page boosts nothing; its link to the shop is a full load. `html/index.html:18`
- Svelte page `ssr-hydrate?who=htmx` is swapped in on `load`. `html/index.html:34`, `html/index.html:35`
- Svelte page `client?who=Ana` is swapped into `#on-click` on a click. `html/index.html:44`
- Svelte page `ssr-nohydrate?who=htmx` is swapped in once `revealed`. `html/index.html:53`, `html/index.html:54`
- Host test checks an `hx-get` to a third origin is refused (`htmx:invalidPath`) and no request goes out. `../../../tests/hosts/e2e/htmx.spec.ts:290`, `../../../tests/hosts/e2e/htmx.spec.ts:301`
- Host test checks the preflight answers 204, `access-control-allow-origin: *`, and echoes the `hx-*` headers. `../../../tests/hosts/e2e/htmx.spec.ts:322`, `../../../tests/hosts/e2e/htmx.spec.ts:324`

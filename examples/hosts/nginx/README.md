# nginx: Server Side Includes, no application code

Droplets embedded by nginx alone: static pages with Server Side Includes,
and a reverse proxy for everything the droplets server owns. Port 8080 is a
basic page with the Svelte example's three droplets; port 8081 is the
[shop demo](../../shop), on an origin of its own.

```bash
docker compose up --build
open http://localhost:8080             # the basic page
open http://localhost:8081/gallery     # the shop (admin / droplets on /login)
```

The compose file starts three services: the Svelte example's droplets
server and the shop (both reached only by nginx) and nginx, which publishes
8080 and 8081 on `127.0.0.1` only. The browser only ever talks to nginx, so
nothing is cross-origin.

## Details

### The basic page (port 8080)

`html/index.html` is a static file. nginx does two things:

- **SSI.** `<!--# include virtual="/droplets/ssr-hydrate?who=nginx" -->`
  makes nginx fetch the fragment while serving the page, so the browser
  receives server-rendered markup.
- **Reverse proxy.** `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*` and `/api/*`
  go to the droplets server. `/api/*` goes through too: a droplet builds
  its API URLs on the droplets server's public origin (`droplet.url()`),
  which here is nginx's.

nginx sends its public URL as `x-droplet-location` (in place of any a
client sent) and clears `Forwarded`, `X-Forwarded-Host`,
`X-Forwarded-Proto` and `X-Forwarded-Prefix`; the droplets server writes the
fragments' URLs on that location. It trusts the header because
`DROPLETS_TRUSTED_ORIGINS` lists its origin, which is also where the host
page is, so `event.host` stays on it.

### The shop demo (`shop/`, port 8081)

A second `server` block serves the shop on its own origin, since its
`/index.js` and `/droplets/*` would collide with the basic server's. Same
two tools, no code:

- `/gallery`, `/product/<slug>`, `/login` and `/admin` are SSI pages in
  `shop/`, with one head, header and footer under `shop/_layout/`.
- Each include goes through the internal `/_fragment/` location, which sends
  the page itself as `Referer` and keeps the browser's `Cookie`
  (subrequests carry it), cut down to the shop's own `cart_id` and
  `shop_admin` by a `map`, so the cart badge and the admin render for the
  visitor and another app's cookie on this origin stays here. The page's query (`$args`) goes to the droplets that take it.
- Only a fragment is pasted: other error answers are replaced with a fixed
  note (`proxy_intercept_errors`), since they may echo the query.
- The product page reads the product's id, name and category from
  `/droplets/product-page/_data?slug=` into an SSI variable and picks them
  out with named captures. An `auth_request` to the product fragment runs
  first: an unknown product answers 404, an old `v` a 302 to the page
  without it.
- `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*` and `/api/*` are proxied with
  `x-droplet-location` set to the shop's public URL and the forwarded
  headers cleared, so the login's `Set-Cookie` and `303`, the cart cookie
  and the form posts pass through untouched. Bodies up to 4 MB (admin image
  uploads).

### What SSI cannot do

An `include virtual` is a subrequest, and nginx copies only its body into
the page. Its response headers are discarded, and no directive copies them
to the main response (`auth_request_set` reads headers from the one
`auth_request` subrequest per location, whose body is thrown away). So:

- a fragment's `Set-Cookie` never reaches the browser;
- its `Link` preloads do not either;
- its redirect is not passed on (the page renders without it).

The shop is fine with that: it sets cookies only on form actions and `/api`,
and those go through the proxy, which passes `Set-Cookie` and `303`s on as
they are. A droplet whose `load` sets a cookie on a plain `GET`, or
redirects, cannot be composed with SSI: render that page in code instead
(njs or OpenResty in nginx, or any of the other hosts here).

### Behind a path or several public URLs

Behind a path prefix, put it in the URL nginx sends
(`x-droplet-location: https://shop.example/mfe`). With more than one public
URL, send each server block's own, and list each origin in
`DROPLETS_TRUSTED_ORIGINS`. See the
[nginx guide](https://dropletsjs.dev/integrate/hosts/nginx/).

### Environment

`docker-compose.yml` reads `DROPLETS_PORT` and `DROPLETS_URL` (the basic
page, default 8080) and `WEB_PORT` and `WEB_URL` (the shop, default 8081).
`nginx.conf` is a template: the nginx image fills in `DROPLETS_PUBLIC_URL`
and `SHOP_PUBLIC_URL` at start.

### IIS

[`iis/web.config`](./iis/web.config) is a URL Rewrite + ARR reverse-proxy
sketch. It has not been run on a Windows host. It sets
`HTTP_X_DROPLET_LOCATION`, the `x-droplet-location` request header, to the
site's public URL written out, clears the incoming `Forwarded` and
`X-Forwarded-*` headers, and needs those five server variables allowed in
`applicationHost.config`; list the URL's origin in the droplets server's
`DROPLETS_TRUSTED_ORIGINS`. IIS cannot include arbitrary URLs server-side, so
pair it with a page that fetches fragments itself (any of the other hosts)
or with the client-only pattern from [`react-vite`](../react-vite).

### Changing this example

No code and no `package.json`: `pnpm typecheck:hosts` skips it. From the
repository root, `pnpm test:hosts nginx` runs the shop flow against the
compose stack on port 8081, and checks that the basic page on port 8080
hydrates through the proxy (needs Docker).

## Facts

- Dockerfile is `nginx:1.27-alpine` with `nginx.conf` as a template and `html/` and `shop/` baked in. `Dockerfile:4`, `Dockerfile:5`, `Dockerfile:6`, `Dockerfile:7`
- Compose droplets service builds `examples/frameworks/Dockerfile` from the repository root and only exposes 8000. `docker-compose.yml:9`, `docker-compose.yml:12`
- Compose droplets service `DROPLETS_TRUSTED_ORIGINS` is the basic page's public URL, default `http://localhost:8080`. `docker-compose.yml:16`
- Compose shop service builds `examples/shop/Dockerfile` and only exposes 8300. `docker-compose.yml:22`, `docker-compose.yml:24`
- Compose shop demo login is `admin` / `droplets`. `docker-compose.yml:27`, `docker-compose.yml:28`
- Compose shop `DROPLETS_SECRET` is a demo value. `docker-compose.yml:31`
- Compose shop `DROPLETS_TRUSTED_ORIGINS` is the shop origin, default `http://localhost:8081`. `docker-compose.yml:34`
- Compose web service publishes `127.0.0.1:${DROPLETS_PORT:-8080}:80` and `127.0.0.1:${WEB_PORT:-8081}:8081`. `docker-compose.yml:41`, `docker-compose.yml:42`
- Compose web service `DROPLETS_PUBLIC_URL` defaults to `http://localhost:8080`, `SHOP_PUBLIC_URL` to `http://localhost:8081`. `docker-compose.yml:44`, `docker-compose.yml:45`
- Upstreams: `droplets:8000` and `shop:8300`. `nginx.conf:17`, `nginx.conf:21`
- Basic server listens on 80, root `/usr/share/nginx/html`, `ssi on` for `/`. `nginx.conf:25`, `nginx.conf:28`, `nginx.conf:33`
- Basic page includes `client`, `ssr-hydrate` and `ssr-nohydrate` with `who=nginx`. `html/index.html:21`, `html/index.html:22`, `html/index.html:23`
- Basic page loads `/index.js` from its own origin. `html/index.html:8`
- Basic proxy: `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*` go to the droplets server. `nginx.conf:40`
- Basic proxy sends `x-droplet-location: ${DROPLETS_PUBLIC_URL}` and clears `Forwarded` and `X-Forwarded-Host`/`-Proto`/`-Prefix`. `nginx.conf:42`, `nginx.conf:46`
- Shop server listens on 8081 with `absolute_redirect off`. `nginx.conf:80`, `nginx.conf:82`
- Shop `/` answers 302 to `/gallery`. `nginx.conf:92`
- Shop pages `/gallery`, `/login`, `/admin` are SSI rewrites to `gallery.html`, `login.html`, `admin.html`. `nginx.conf:94`, `nginx.conf:146`, `nginx.conf:150`
- Shop product slug pattern is `[a-z0-9]+(?:-[a-z0-9]+)*`. `nginx.conf:106`
- Shop product check: `auth_request /_product-check` asks the `product-page` fragment first. `nginx.conf:112`, `nginx.conf:123`
- Shop product check: a 404 becomes 401, then `not-found.html` as 404. `nginx.conf:113`, `nginx.conf:134`, `nginx.conf:138`
- Shop product check: a redirect (old `v`) becomes 403, then a 302 to the page without `v`. `nginx.conf:114`, `nginx.conf:135`, `nginx.conf:144`
- Shop product check sends no `Cookie` and no body. `nginx.conf:124`, `nginx.conf:126`
- Shop `v` query param is split off by `map` blocks into `$shop_page_v` and `$shop_query_without_v`. `nginx.conf:52`, `nginx.conf:61`
- Shop product `_data` read is kept in an SSI variable, room 64k (`subrequest_output_buffer_size`). `nginx.conf:88`, `shop/product.html:1`
- Shop product id, name and category come from named captures on the `_data` JSON. `shop/product.html:2`
- Shop product name and category are echoed with `encoding="entity"` or `encoding="url"`. `shop/product.html:5`, `shop/product.html:13`
- Shop any other path answers 404. `nginx.conf:162`
- Shop proxy: `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*` go to the shop with `x-droplet-location: ${SHOP_PUBLIC_URL}` and the forwarded headers cleared. `nginx.conf:167`, `nginx.conf:169`
- Shop proxy `client_max_body_size` is 4m. `nginx.conf:176`
- Shop fragments go through the internal `/_fragment/` location. `nginx.conf:184`, `nginx.conf:185`
- Shop proxy and fragment subrequests send the shop only `cart_id` and `shop_admin`, from the `$shop_cookie` map. `nginx.conf:69`, `nginx.conf:171`, `nginx.conf:188`
- Shop fragment `Referer` is `${SHOP_PUBLIC_URL}$request_uri`, the page itself. `nginx.conf:186`
- Shop fragment sends `Accept: text/html` and no `Accept-Encoding`. `nginx.conf:187`, `nginx.conf:189`
- Shop fragment errors 400, 401, 403, 404, 405, 413, 431, 502, 503, 504 become `<p class="shop-unavailable">This droplet is unavailable.</p>`; a 500 is pasted. `nginx.conf:198`, `nginx.conf:202`
- Shop layout: `_layout/head.html`, `header.html`, `footer.html`, internal only. `nginx.conf:157`, `nginx.conf:158`
- Shop head loads `/shop.css` and `/index.js` from the shop origin, with speculation rules for `/product/*`. `shop/_layout/head.html:3`, `shop/_layout/head.html:4`, `shop/_layout/head.html:6`
- Shop header includes `toast-center` first, then `shopping-cart?variant=badge`. `shop/_layout/header.html:2`, `shop/_layout/header.html:9`
- Shop gallery passes `$args` to `product-filter` and `product-library`. `shop/gallery.html:16`, `shop/gallery.html:17`
- Shop product page: `product-page` gets `slug` and `v`; `product-comments` gets `productId` and `$args`. `shop/product.html:16`, `shop/product.html:18`
- Shop footer links the basic page at `DROPLETS_PUBLIC_URL`, echoed by SSI from `$droplets_public_url`. `shop/_layout/footer.html:4`, `nginx.conf:85`
- Shop footer stack label is `nginx 1.27`. `shop/_layout/footer.html:2`
- `iis/web.config` sets `HTTP_X_DROPLET_LOCATION` (the `x-droplet-location` header the droplets server reads) to the site's public URL, written out, and clears the incoming `Forwarded`, `X-Forwarded-Host`, `X-Forwarded-Proto` and `X-Forwarded-Prefix`. `iis/web.config:35`, `iis/web.config:36`, `iis/web.config:39`, `iis/web.config:11`
- `iis/web.config` needs its five server variables allowed in `applicationHost.config`. `iis/web.config:15`
- `iis/web.config` rewrites `index.js`, `env.js`, `index.css`, `droplets/*`, `assets/*`, `api/*` to `http://localhost:8000`. `iis/web.config:32`, `iis/web.config:33`
- `pnpm test:hosts nginx` tests the shop on `http://localhost:8081`. `../../../tests/hosts/run.mjs:59`
- `pnpm test:hosts nginx` also checks the basic page on `DROPLETS_URL` (`http://localhost:8080`): `/env.js` and `/index.css` come through the proxy and the three droplets hydrate. `../../../tests/hosts/e2e/nginx-basic.spec.ts:12`, `../../../tests/hosts/e2e/nginx-basic.spec.ts:22`
- `examples/hosts/*` is outside the pnpm workspace. `../../../pnpm-workspace.yaml:5`

# Ruby (Sinatra)

A Sinatra app that embeds droplets from a separate droplets server. It
fetches each droplet's HTML on the server with `Net::HTTP`, pastes it into an
ERB view and loads `/index.js` once. The same app hosts the
[shop example](../../shop) at `/gallery`.

```bash
docker compose up --build
open http://localhost:8002          # the basic page: three Svelte droplets
open http://localhost:8002/gallery  # the shop (demo login: admin / droplets)
```

Set `SHOP_SECRET` and `DROPLETS_SECRET` first (32 or more random characters
each, `openssl rand -hex 32`), in the environment or a `.env` file beside
`docker-compose.yml`: compose refuses to start without them. `pnpm test:hosts`
generates its own for a run.

| Service | Port | What it is |
|---|---|---|
| `web` | 8002 | this Sinatra app |
| `droplets` | 8000 | the Svelte example (`examples/frameworks/svelte`) as a droplets server |
| `shop` | 8300, compose network only | the shop example, reached through `web` |

## Details

### The basic page (`app.rb`)

`GET /` fetches `GET /droplets/<id>?who=<who>` for `client`, `ssr-hydrate` and
`ssr-nohydrate`, with `x-droplet-location` set to `DROPLETS_PUBLIC_URL`, and
renders the fragments into `views/index.erb`. `?who=Ruby` changes the prop. A
droplet that fails renders an inline `<p class="error">`.

The browser loads each droplet's JavaScript from `http://localhost:8000`, a
different origin than the page, so the droplets server runs with `cors: true`
and lists this host's origin in `DROPLETS_TRUSTED_ORIGINS`.

Without Docker, with a droplets server already running on port 8000:

```bash
bundle install
bundle exec ruby app.rb
```

| Variable | Default | What it is |
|---|---|---|
| `PORT` | `8002` | the port Sinatra listens on (all interfaces) |
| `DROPLETS_INTERNAL_URL` | `http://localhost:8000` | where this process fetches fragments |
| `DROPLETS_PUBLIC_URL` | `http://localhost:8000` | the browser-facing droplets origin: `x-droplet-location` and the `/index.js` URL |
| `SHOP_INTERNAL_URL` | `http://localhost:8300` | where this process reaches the shop |
| `SHOP_PUBLIC_URL` | `http://localhost:<PORT>` | this host's public origin, sent to the shop as `x-droplet-location` |

### The shop (`shop.rb`)

`shop.rb` adds four pages, `/gallery`, `/product/<slug>`, `/login` and
`/admin`, that fetch the shop's fragments on the server (one thread per
fragment) into ERB views under `views/shop/`. It follows the shop's
[`CONTRACT.md`](../../shop/CONTRACT.md).

- A same-origin proxy passes `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*` and
  `/api/*` to the shop, so its cookies (the cart, the admin session) are this
  origin's own and nothing is cross-origin.
- `x-droplet-location` is `SHOP_PUBLIC_URL`, set in the environment, never the
  request's Host. The shop lists that origin in `DROPLETS_TRUSTED_ORIGINS`.
- Fragment fetches forward the browser's `Cookie` cut down to the shop's own
  `cart_id` and `shop_admin` (so does the proxy), send the page URL as
  `Referer`, never follow redirects and insert only `text/html` answers. Their
  `Set-Cookie` goes back with the page, a droplet's redirect is answered with
  its status, and their `Link` preloads on this origin go into `<head>`.
- Every shop page fetches `toast-center` and the cart badge
  (`shopping-cart`, `variant=badge`) with its own fragments.
- Sinatra reads a form body into `params` before the route runs, so the app
  buffers the request body (`ShopBufferedInput`, up to 4 MB: a bigger one
  is a 413) and turns `method_override` off; the proxy passes the same body
  on.
- The layout's stylesheet is `public/shop.css`, the same file as the other
  hosts' copy.

Without Docker, start the shop (`pnpm --filter @dropletsjs/example-shop build`,
then `pnpm start` in `examples/shop` with
`DROPLETS_TRUSTED_ORIGINS=http://localhost:8002`), then run this app.

### Tests

From the repository root, `pnpm test:hosts sinatra` starts this compose stack,
runs the shop flow (`tests/hosts/e2e/shop.spec.ts`) against
http://localhost:8002 and takes the stack down. It needs Docker.

## Facts

- Sinatra listens on `PORT`, default 8002, bound to `0.0.0.0`. `app.rb:19`, `app.rb:20`
- `DROPLETS_INTERNAL_URL` defaults to `http://localhost:8000`. `app.rb:12`
- `DROPLETS_PUBLIC_URL` defaults to `http://localhost:8000`. `app.rb:14`
- Basic page droplets are `client`, `ssr-hydrate` and `ssr-nohydrate`. `app.rb:17`
- Basic page prop `who` comes from the query, default `Sinatra`. `app.rb:46`
- Basic page fragment fetch sends `accept: text/html` and `x-droplet-location: DROPLETS_PUBLIC_URL`; `Net::HTTP` never follows a redirect. `app.rb:32`
- Basic page fragment fetch has 5 second open and read timeouts. `app.rb:31`
- Basic page pastes only a 2xx or 500 `text/html` answer; anything else, or a failure, renders `<p class="error">` with the id and the error escaped. `app.rb:37`, `app.rb:39`, `app.rb:41`
- Basic page loads `<DROPLETS_PUBLIC_URL>/index.js` as a module script. `views/index.erb:7`
- Droplets server image is `examples/frameworks/Dockerfile`, the Svelte example by default. `docker-compose.yml:9`, `../../frameworks/Dockerfile:24`
- Droplets server CORS: the Svelte example sets `cors: true`. `../../frameworks/svelte/droplets.config.ts:16`
- Droplets server `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and `WEB_URL` (this host). `docker-compose.yml:14`
- Shop `DROPLETS_TRUSTED_ORIGINS` is `WEB_URL`, this host's public origin. `docker-compose.yml:32`
- Shop service is exposed on 8300 inside the compose network only. `docker-compose.yml:22`
- Shop demo login is `admin` / `droplets`. `docker-compose.yml:26`, `docker-compose.yml:27`
- Shop service `SHOP_SECRET` and `DROPLETS_SECRET` are required from the environment (`${VAR:?…}`), no default. `docker-compose.yml:28`, `docker-compose.yml:30`
- Published ports bind `127.0.0.1`: droplets `DROPLETS_PORT` (8000), web `WEB_PORT` (8002). `docker-compose.yml:11`, `docker-compose.yml:37`
- Web `SHOP_PUBLIC_URL` is `WEB_URL`, default `http://localhost:8002`. `docker-compose.yml:42`
- `SHOP_INTERNAL_URL` defaults to `http://localhost:8300`, trailing slashes stripped. `shop.rb:20`
- `SHOP_PUBLIC_URL` defaults to `http://localhost:<PORT>` and is reduced to its origin. `shop.rb:24`
- Shop proxy sends `x-droplet-location: SHOP_ORIGIN`, never the request's Host. `shop.rb:90`
- Shop proxy forwards only `accept`, `accept-language`, `content-type`, `if-none-match`, `origin`, `referer`, `user-agent`, `x-droplet-props`, `x-droplets-build`, plus `cookie` cut down to `cart_id` and `shop_admin` (`SHOP_COOKIES`). `shop.rb:29`, `shop.rb:35`, `shop.rb:95`
- Shop proxy drops hop-by-hop response headers and passes `Set-Cookie` untouched. `shop.rb:41`, `shop.rb:106`
- Shop proxy paths: `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*`, for GET (and HEAD, which Sinatra's `get` answers too), POST, PUT, PATCH, DELETE and OPTIONS. `shop.rb:238`, `shop.rb:239`
- Shop proxy concatenates the path onto the shop's base, never resolves it. `shop.rb:76`
- Shop proxy asks for `accept-encoding: identity`. `shop.rb:77`
- Shop proxy timeouts: open 5 seconds, read 10 seconds. `shop.rb:79`
- Shop proxy answers 502 `The shop is unreachable.` when the shop fails. `shop.rb:110`
- Request body is buffered by `ShopBufferedInput`, up to 4 MB (`SHOP_MAX_BODY`; above it, 413), with `method_override` off. `shop.rb:38`, `shop.rb:228`, `shop.rb:229`, `shop.rb:218`
- Shop fragment fetch sends `accept: text/html`, `x-droplet-location`, the page URL as `referer` and the browser's `cookie` cut down to the shop's. `shop.rb:118`, `shop.rb:119`
- Shop fragment 3xx is kept as a redirect, not followed. `shop.rb:127`
- Shop fragment is inserted only for 2xx or 500 with `text/html`. `shop.rb:129`
- Shop fragment otherwise renders `<p class="shop-unavailable">`. `shop.rb:138`
- Shop page fetches `toast-center`, `shopping-cart` (`variant=badge`) and its own fragments, one thread each. `shop.rb:194`, `shop.rb:195`
- Shop page sets `cache-control: private, no-store`. `shop.rb:197`
- Shop page passes every fragment's `Set-Cookie` on. `shop.rb:198`
- Shop page answers a fragment's redirect with its status and `location`. `shop.rb:200`
- Shop `Link` preloads keep only `preload` and `modulepreload` on `SHOP_ORIGIN`. `shop.rb:166`, `shop.rb:169`
- Shop product lookup reads `/droplets/product-page/_data?slug=<slug>`. `shop.rb:144`
- Shop product page answers 404 with the `not_found` view for an unknown slug. `shop.rb:255`
- Shop product comments props: `order`, `page`, `showing` from the query, plus `productId`. `shop.rb:258`
- Shop product page props: `slug`, plus `v` from the query. `shop.rb:261`
- Shop gallery passes the whole query to `product-filter` and `product-library`. `shop.rb:247`, `shop.rb:249`
- Shop login passes `next`; shop admin passes `view` and `id`. `shop.rb:268`, `shop.rb:272`
- Shop footer stack name is `Sinatra 4`. `shop.rb:17`
- Shop layout loads `/shop.css`, the preloads, speculation rules and `/index.js`. `views/shop/layout.erb:7`, `views/shop/layout.erb:10`
- Gems: `sinatra ~> 4.1`, `rackup ~> 2.2`, `webrick ~> 1.9`. `Gemfile:3`, `Gemfile:4`, `Gemfile:6`
- Docker image is `ruby:3.3-slim`, started with `bundle exec ruby app.rb`. `Dockerfile:1`, `Dockerfile:7`
- `pnpm test:hosts sinatra` expects this host on `http://localhost:8002`. `../../../tests/hosts/run.mjs:61`
- `pnpm test:hosts` runs `shop.spec.ts` for this host; the other specs skip themselves. `../../../tests/hosts/run.mjs:265`
- Host is outside the pnpm workspace: `examples/hosts/*` is not listed. `../../../pnpm-workspace.yaml:5`

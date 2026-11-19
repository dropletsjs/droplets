# Ruby (Rails)

A Rails app that embeds droplets from a separate droplets server. A
controller fetches each droplet's HTML on the server with `Net::HTTP`, an ERB
view prints it and loads `/index.js` once. The same app hosts the
[shop example](../../shop) at `/gallery`. It has no database: the shop's
droplets server holds the data.

```bash
docker compose up --build
open http://localhost:8015          # the basic page: three Svelte droplets
open http://localhost:8015/gallery  # the shop (demo login: admin / droplets)
```

Set `SHOP_SECRET` and `DROPLETS_SECRET` first (32 or more random characters
each, `openssl rand -hex 32`), in the environment or a `.env` file beside
`docker-compose.yml`: compose refuses to start without them. `pnpm test:hosts`
generates its own for a run.

| Service | Port | What it is |
|---|---|---|
| `web` | 8015 | this Rails app, on Puma |
| `droplets` | 8000 | the Svelte example (`examples/frameworks/svelte`) as a droplets server |
| `shop` | 8300, compose network only | the shop example, reached through `web` |

## Details

### The basic page (`HomeController`)

`GET /` fetches `GET /droplets/<id>?who=<who>` for `client`, `ssr-hydrate` and
`ssr-nohydrate`, with `x-droplet-location` set to `DROPLETS_PUBLIC_URL`, and
renders the fragments into `app/views/home/index.html.erb`. `?who=Ruby`
changes the prop. A droplet that fails renders an inline `<p class="error">`.

The browser loads each droplet's JavaScript from `http://localhost:8000`, a
different origin than the page, so the droplets server runs with `cors: true`
and lists this host's origin in `DROPLETS_TRUSTED_ORIGINS`.

Without Docker, with a droplets server already running on port 8000:

```bash
bundle install
bundle exec puma -C config/puma.rb
```

| Variable | Default | What it is |
|---|---|---|
| `PORT` | `8015` | the port Puma listens on (all interfaces) |
| `DROPLETS_INTERNAL_URL` | `http://localhost:8000` | where this process fetches fragments |
| `DROPLETS_PUBLIC_URL` | `http://localhost:8000` | the browser-facing droplets origin: `x-droplet-location` and the `/index.js` URL |
| `SHOP_INTERNAL_URL` | `http://localhost:8300` | where this process reaches the shop |
| `SHOP_PUBLIC_URL` | `http://localhost:<PORT>` | this host's public origin, sent to the shop as `x-droplet-location` |
| `SECRET_KEY_BASE` | one per process | Rails' key; nothing here is signed with it |

### The shop (`ShopController`, `ShopProxy`, `Shop`)

`ShopController` has four pages, `/gallery`, `/product/<slug>`, `/login` and
`/admin`, that fetch the shop's fragments on the server (`Shop.fragment`, one
thread per fragment) into ERB views under `app/views/shop/`. It follows the
shop's [`CONTRACT.md`](../../shop/CONTRACT.md).

- `ShopProxy`, a Rack endpoint in `config/routes.rb`, passes `/index.js`,
  `/env.js`, `/index.css`, `/droplets/*`, `/assets/*` and `/api/*` to the
  shop, so its cookies (the cart, the admin session) are this origin's own
  and nothing is cross-origin.
- `x-droplet-location` is `SHOP_PUBLIC_URL`, set in the environment, never the
  request's Host. The shop lists that origin in `DROPLETS_TRUSTED_ORIGINS`.
- Fragment fetches forward the browser's `Cookie` cut down to the shop's own
  `cart_id` and `shop_admin` (so does the proxy), send the page URL as
  `Referer`, never follow redirects and insert only `text/html` answers. Their
  `Set-Cookie` goes back with the page, a droplet's redirect is answered with
  its status, and their `Link` preloads on this origin go into `<head>`.
- Every shop page fetches `toast-center` and the cart badge
  (`shopping-cart`, `variant=badge`) with its own fragments.
- The proxy is a Rack endpoint, not a controller action: `ActionController`
  would parse the body into `params` and ask a post for a CSRF token before
  the action ran, and rewrite the answer's `Cache-Control`. It reads the body
  itself once routed, up to 4 MB (a bigger one is a 413), and refuses a `.`
  or `..` segment with a 400.
- `config/application.rb` turns off `Rack::MethodOverride` (it parses a form
  body before routing), `Rack::ETag` and `Rack::ConditionalGet` (the shop's
  answers keep their own caching headers), and the session.
- The layout's stylesheet is `public/shop.css`, the same file as the other
  hosts' copy.

Without Docker, start the shop (`pnpm --filter @dropletsjs/example-shop build`,
then `pnpm start` in `examples/shop` with
`DROPLETS_TRUSTED_ORIGINS=http://localhost:8015`), then run this app.

### Tests

`test/integration/shop_test.rb` checks the host's own logic against a stand-in
for the shop: a body over the limit and a dot segment refused before the shop
is asked, only the listed headers and the shop's cookies sent, the body,
every `Set-Cookie` and a redirect passed back, a 502 when the shop is down, a
fragment that is not HTML never inserted, a fragment's redirect answered and
not followed, the page URL as `Referer`, a 404 for an unknown product. The
image runs them as it builds (`bin/rails test`); without Docker,
`bin/rails test`.

From the repository root, `pnpm test:hosts rails` starts this compose stack,
runs the shop flow (`tests/hosts/e2e/shop.spec.ts`) against
http://localhost:8015 and takes the stack down. It needs Docker.

## Facts

- Puma listens on `PORT`, default 8015, on all interfaces, 5 threads. `config/puma.rb:1`, `config/puma.rb:2`
- Rails loads only `action_controller` and `action_view`: no database, mail, jobs or asset pipeline. `config/application.rb:4`, `config/application.rb:5`
- `config.load_defaults 8.1`; eager loading everywhere but the test environment. `config/application.rb:11`, `config/application.rb:12`
- Logs go to stdout at `info`. `config/application.rb:13`, `config/application.rb:14`
- `public/` is served by Rails (`public_file_server.enabled`). `config/application.rb:15`
- `secret_key_base` is `SECRET_KEY_BASE`, or random per process. `config/application.rb:19`
- The session store is disabled. `config/application.rb:20`
- `Rack::MethodOverride`, `Rack::ETag` and `Rack::ConditionalGet` are removed from the middleware. `config/application.rb:24`, `config/application.rb:26`, `config/application.rb:27`
- `DROPLETS_INTERNAL_URL` defaults to `http://localhost:8000`. `app/controllers/home_controller.rb:13`
- `DROPLETS_PUBLIC_URL` defaults to `http://localhost:8000`. `app/controllers/home_controller.rb:15`
- Basic page droplets are `client`, `ssr-hydrate` and `ssr-nohydrate`. `app/controllers/home_controller.rb:18`
- Basic page prop `who` is the permitted scalar `who` param, default `Rails`. `app/controllers/home_controller.rb:23`
- Basic page fragment fetch sends `accept: text/html` and `x-droplet-location: DROPLETS_PUBLIC_URL`; `Net::HTTP` never follows a redirect. `app/controllers/home_controller.rb:37`
- Basic page fragment fetch has 5 second open and read timeouts. `app/controllers/home_controller.rb:36`
- Basic page prints only a 2xx or 500 `text/html` answer (`html_safe`); anything else, or a failure, renders `<p class="error">` with `tag.p`, escaped. `app/controllers/home_controller.rb:42`, `app/controllers/home_controller.rb:44`, `app/controllers/home_controller.rb:46`
- Basic page loads `<DROPLETS_PUBLIC_URL>/index.js` as a module script. `app/views/home/index.html.erb:7`
- Routes: `/` to `home#index`; `/gallery`, `/product/:slug`, `/login`, `/admin` to `ShopController`, GET only, no format. `config/routes.rb:3`, `config/routes.rb:6`
- Droplets server image is `examples/frameworks/Dockerfile`, the Svelte example by default. `docker-compose.yml:9`, `../../frameworks/Dockerfile:24`
- Droplets server CORS: the Svelte example sets `cors: true`. `../../frameworks/svelte/droplets.config.ts:16`
- Droplets server `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and `WEB_URL` (this host). `docker-compose.yml:14`
- Shop `DROPLETS_TRUSTED_ORIGINS` is `WEB_URL`, this host's public origin. `docker-compose.yml:32`
- Shop service is exposed on 8300 inside the compose network only. `docker-compose.yml:22`
- Shop demo login is `admin` / `droplets`. `docker-compose.yml:26`, `docker-compose.yml:27`
- Shop service `SHOP_SECRET` and `DROPLETS_SECRET` are required from the environment (`${VAR:?…}`), no default. `docker-compose.yml:28`, `docker-compose.yml:30`
- Published ports bind `127.0.0.1`: droplets `DROPLETS_PORT` (8000), web `WEB_PORT` (8015). `docker-compose.yml:11`, `docker-compose.yml:37`
- Web `SHOP_PUBLIC_URL` is `WEB_URL`, default `http://localhost:8015`. `docker-compose.yml:42`
- `SHOP_INTERNAL_URL` defaults to `http://localhost:8300`, trailing slashes stripped. `app/models/shop.rb:14`
- `SHOP_PUBLIC_URL` defaults to `http://localhost:<PORT>` and is reduced to its origin (`Shop::ORIGIN`). `app/models/shop.rb:17`
- Shop proxy routes: `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*`, every verb (`via: :all`), to the Rack endpoint `ShopProxy`. `config/routes.rb:14`, `config/routes.rb:15`
- Shop proxy refuses a `.` or `..` path segment, once decoded, with 400 `Bad request.` `app/controllers/shop_proxy.rb:13`
- Shop proxy reads a body only after routing, up to 4 MB (`Shop::MAX_BODY`): a larger `Content-Length` or body answers 413 `The body is too large.` `app/controllers/shop_proxy.rb:20`, `app/controllers/shop_proxy.rb:22`, `app/controllers/shop_proxy.rb:23`, `app/models/shop.rb:31`
- Shop proxy sends `x-droplet-location: Shop::ORIGIN`, never the request's Host. `app/models/shop.rb:66`
- Shop proxy forwards only `accept`, `accept-language`, `content-type`, `if-none-match`, `origin`, `referer`, `user-agent`, `x-droplet-props`, `x-droplets-build`, plus `cookie` cut down to `cart_id` and `shop_admin` (`Shop::COOKIES`). `app/models/shop.rb:22`, `app/models/shop.rb:28`, `app/models/shop.rb:57`
- Shop proxy target is `request.original_fullpath` concatenated onto the shop's base, never resolved. `app/controllers/shop_proxy.rb:25`, `app/models/shop.rb:48`
- Shop proxy asks for `accept-encoding: identity`. `app/models/shop.rb:49`
- Shop proxy timeouts: open 5 seconds, read 10 seconds. `app/models/shop.rb:51`
- Shop proxy drops hop-by-hop response headers and passes every `Set-Cookie` untouched. `app/models/shop.rb:34`, `app/controllers/shop_proxy.rb:29`, `app/controllers/shop_proxy.rb:33`
- Shop proxy answers 502 `The shop is unreachable.` when the shop fails. `app/controllers/shop_proxy.rb:37`
- Shop fragment fetch sends `accept: text/html`, `x-droplet-location`, the page URL (`Shop::ORIGIN` plus `request.original_fullpath`) as `referer` and the browser's `cookie` cut down to the shop's. `app/models/shop.rb:81`, `app/models/shop.rb:82`, `app/controllers/shop_controller.rb:54`
- Shop fragment 3xx is kept as a redirect, not followed. `app/models/shop.rb:89`
- Shop fragment is inserted (`html_safe`) only for 2xx or 500 with `text/html`. `app/models/shop.rb:91`, `app/models/shop.rb:93`
- Shop fragment otherwise renders `<p class="shop-unavailable">`, escaped by `tag.p`. `app/models/shop.rb:100`
- Shop page fetches `toast-center`, `shopping-cart` (`variant=badge`) and its own fragments, one thread each, inside the Rails executor. `app/controllers/shop_controller.rb:55`, `app/controllers/shop_controller.rb:57`
- Shop page sets `cache-control: private, no-store`. `app/controllers/shop_controller.rb:62`
- Shop page passes every fragment's `Set-Cookie` on. `app/controllers/shop_controller.rb:64`
- Shop page answers a fragment's redirect with its status and `location`, with `head`, not `redirect_to`. `app/controllers/shop_controller.rb:68`, `app/controllers/shop_controller.rb:69`
- Shop pages read the query from the raw query string as name and value pairs. `app/controllers/shop_controller.rb:38`
- Shop `Link` preloads keep only `preload` and `modulepreload` on `Shop::ORIGIN`. `app/models/shop.rb:127`, `app/models/shop.rb:130`
- Shop product lookup reads `/droplets/product-page/_data?slug=<slug>`. `app/models/shop.rb:106`
- Shop product page answers 404 with the `not_found` view for an unknown slug. `app/controllers/shop_controller.rb:16`
- Shop product comments props: `order`, `page`, `showing` from the query, plus `productId`. `app/controllers/shop_controller.rb:19`
- Shop product page props: `slug`, plus `v` from the query. `app/controllers/shop_controller.rb:22`
- Shop gallery passes the whole query to `product-filter` and `product-library`. `app/controllers/shop_controller.rb:9`, `app/controllers/shop_controller.rb:11`
- Shop login passes `next`; shop admin passes `view` and `id`. `app/controllers/shop_controller.rb:27`, `app/controllers/shop_controller.rb:31`
- Shop footer stack name is `Rails 8`. `app/models/shop.rb:11`
- Shop layout loads `/shop.css`, the preloads, speculation rules and `/index.js`. `app/views/layouts/shop.html.erb:7`, `app/views/layouts/shop.html.erb:10`
- Gems: `railties`, `actionpack`, `actionview` `~> 8.1`, `puma ~> 8.0`; no lockfile. `Gemfile:4`, `Gemfile:5`, `Gemfile:6`, `Gemfile:7`
- Docker image is `ruby:4.0-slim`, gems built in a stage with `build-essential` and `libyaml-dev`, started with `bundle exec puma -C config/puma.rb`. `Dockerfile:1`, `Dockerfile:8`, `Dockerfile:20`
- The image build runs `bin/rails test`; a failing test fails it. `Dockerfile:14`
- `pnpm test:hosts rails` expects this host on `http://localhost:8015`. `../hosts.json`, `../../../tests/hosts/run.mjs:71`
- `pnpm test:hosts` runs `shop.spec.ts` for this host; the other specs skip themselves. `../../../tests/hosts/run.mjs:271`
- Host is outside the pnpm workspace: `examples/hosts/*` is not listed. `../../../pnpm-workspace.yaml:5`

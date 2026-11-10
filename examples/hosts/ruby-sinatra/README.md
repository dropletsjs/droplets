# Ruby (Sinatra)

`app.rb` fetches `GET /droplets/<id>` with `Net::HTTP`, sends `x-host` so the
fragments point at the browser-facing origin, and renders them into an ERB
view that loads `/index.js` once.

```bash
docker compose up --build
open http://localhost:8002
```

Without Docker, with a droplets server already running on port 8000:

```bash
bundle install
bundle exec ruby app.rb
```

The browser loads each droplet's JavaScript from `http://localhost:8000`, a
different origin than the page, so the droplets server runs with `cors: true`.

## The shop demo

The same compose file runs the [shop example](../../shop) beside
the basic page: open http://localhost:8002/gallery. `shop.rb` adds four pages (`/gallery`,
`/product/<slug>`, `/login`, `/admin`) that fetch the shop's fragments on the
server with `Net::HTTP` (one thread per fragment) into ERB views under `views/shop/`, and proxies `/index.js`, `/droplets/*`, `/assets/*` and `/api/*`
to the shop under this host's own origin, so its cookies (the cart, the admin
session) are first-party and nothing is cross-origin.

- `x-host` is `SHOP_PUBLIC_URL`, written out in the environment: never the
  request's Host. The shop lists that origin in `DROPLETS_TRUSTED_ORIGINS`.
- Fragment fetches forward the browser's `Cookie`, send the page URL as
  `Referer`, never follow redirects, and insert only `text/html` answers;
  their `Set-Cookie` goes back with the page, their `Link` preloads into its
  `<head>`.
- The layout's stylesheet is `public/shop.css`, the same file in every host.

Without Docker, start the shop (`pnpm --filter @dropletsjs/example-shop build`,
then `pnpm start` in `examples/shop` with `DROPLETS_TRUSTED_ORIGINS=http://localhost:8002`)
and set `SHOP_INTERNAL_URL` (default `http://localhost:8300`).

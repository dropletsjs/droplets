# Node (Express)

Two ways to combine Express with droplets.

## 1. Express as a host (`src/server.js`)

The droplets server runs as its own process. Express fetches `GET /droplets/<id>`
for each droplet, with `x-host` set to the browser-facing origin, and renders
the fragments into its page. This is the same pattern every non-Node example
uses.

```bash
docker compose up --build
open http://localhost:8003
```

### The shop demo (`src/shop.js`)

The same app also hosts the [shop example](../../shop) at
`/gallery`, `/product/<slug>`, `/login` and `/admin`
(see its [`CONTRACT.md`](../../shop/CONTRACT.md)):

- a same-origin proxy for `/index.js`, `/droplets/*`, `/assets/*` and
  `/api/*` (bodies streamed, `Set-Cookie` and redirects passed back
  untouched), so the cart and admin cookies are this origin's own;
- the pages fetch their fragments on the server with `x-host` (the
  configured `SHOP_PUBLIC_URL`, never the request's Host), the browser's
  `Cookie`, the page as `Referer` and `redirect: "manual"`; only an HTML
  answer is pasted, the fragments' `Set-Cookie` go out with the page and
  their `Link` preloads go into its `<head>`.

`docker compose up --build` starts the shop too (demo login: admin /
droplets); open http://localhost:8003/gallery. Outside Docker, run the shop
(`cd examples/shop && pnpm build && pnpm start`, with
`DROPLETS_TRUSTED_ORIGINS=http://localhost:8003`) and `npm start` here.

### Over https, off localhost

The shop's cookies are `Secure` everywhere except plain HTTP to
`localhost`, so a host on another name needs https. The
`docker-compose.https.yml` override puts Caddy in front (`Caddyfile`,
`tls internal`: Caddy's own CA, no ACME) on
`https://127-0-0-1.sslip.io:8443`, a public name that resolves to
127.0.0.1, and makes that the host's `SHOP_PUBLIC_URL` and the shop's
trusted origin:

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml up --build
open https://127-0-0-1.sslip.io:8443/gallery   # accept the certificate warning
```

`pnpm test:hosts express --https` (from the repository root) runs the shop
flow there and checks that `cart_id` and `shop_admin` arrive `Secure` and
`HttpOnly`, and that the cart and the login work.

## 2. One process (`src/embedded.js`)

`vite build` emits `dist/server.js`, which exports `{ fetch }` and does not
listen on its own when imported. Express mounts it as a request listener, so
droplet routes and Express routes share one origin: no CORS, no `x-host`, and
the page can even call `fetch()` in-process to render fragments without an
HTTP round trip.

```bash
# from the repository root
pnpm build && pnpm build:example
cd examples/hosts/express && npm install
DROPLETS_DIST=../../basic/dist node src/embedded.js
open http://localhost:8003
```

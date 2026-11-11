# Shop

A demo shop as one droplets server: nine droplets in six frameworks on
SQLite, with form actions that work without JavaScript, cookies, uploads, a
login and an admin. Its element is `<djs-shop>`. Nine of the host examples in
[`examples/hosts`](../hosts) build the same pages around it (`/gallery`,
`/product/<slug>`, `/login`, `/admin`); the docs'
[shop demo](https://dropletsjs.dev/integrate/hosts/shop-demo/) shows each one
recorded.

## The droplets

| Droplet | Framework | Mode |
| ------- | --------- | ---- |
| `product-filter` | Hono JSX | server-rendered, hydrates on the first interaction |
| `product-library` | Svelte | server-rendered, hydrated |
| `product-card` | Svelte | server-rendered, hydrates when visible |
| `product-page` | Handlebars | server-rendered, prerendered per product, no JavaScript |
| `product-comments` | Solid | server-rendered, prerendered, hydrates when visible |
| `shopping-cart` | React | client-only |
| `toast-center` | Solid | client-only |
| `login` | Hono JSX | server-rendered, no JavaScript |
| `product-admin` | Vue | server-rendered, hydrated |

[`CONTRACT.md`](./CONTRACT.md) is the contract for hosts: every droplet's
props, the events they send each other on `window`, the JSON API and the
headers a host must pass.

## Run it

From the repository root, after `pnpm install` and `pnpm build`:

```bash
cp examples/shop/.env.example examples/shop/.env   # the demo values, once
pnpm dev:shop                                      # vite dev on http://localhost:5174
```

`pnpm dev:shop` seeds `shop.db` from `data/` when it is missing
(`pnpm --filter @dropletsjs/example-shop seed` seeds it again). The login is
**admin / droplets**, the demo values in [`.env.example`](./.env.example):
`ADMIN_USER`, `ADMIN_PASSWORD`, `SHOP_SECRET` (the admin cookie's key) and
`DROPLETS_SECRET` (signs a form's result when JavaScript is off). Real
deployments set their own.

```bash
pnpm --filter @dropletsjs/example-shop build   # dist/server.js
pnpm --filter @dropletsjs/example-shop start   # http://localhost:8300, reads .env
pnpm test:example:shop                         # the tests (vitest)
```

## The data

`data/products.json` and `data/comments.json` are committed; the seed reads
them, never a network. `pnpm --filter @dropletsjs/example-shop generate:data`
rewrites their text with an LLM, a development tool run once: it needs
`LLM_URL` (the base URL of an OpenAI-compatible server, without `/v1`) and
`LLM_MODEL` (the model it serves), from the environment or the repository's
`.env.local`. `generate:images` does the same for the product images with a
ComfyUI server (`COMFY_URL`).

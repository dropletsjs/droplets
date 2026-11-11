# SvelteKit

Droplets are Svelte components too, but this example treats the droplets
server as what it is from the outside: a remote service. `+page.server.ts`
fetches `GET /droplets/<id>` for each droplet and the page renders the fragments
with `{@html}`; `<svelte:head>` loads `/index.js` once.

```bash
docker compose up --build
open http://localhost:8006
```

Without Docker, with a droplets server already running on port 8000:

```bash
npm install
npm run dev
```

The page and the droplets server are different origins, so the droplets
server runs with `cors: true`.

## The shop demo

`/gallery`, `/product/:slug`, `/login` and `/admin` (the `(shop)` route
group) embed the shop (`examples/shop`, see its `CONTRACT.md`), beside the
basic page at `/`:

- `src/hooks.server.ts` proxies `/index.js`, `/droplets/*`, `/assets/*` and
  `/api/*` to the shop before routing, with a fixed `x-droplet-location`
  (`SHOP_PUBLIC_URL`), so its cookies are first-party;
- the `(shop)` loads fetch fragments with the browser's `Cookie` and the
  page's URL as `Referer` (`src/lib/shop-page.server.ts`); their
  `Set-Cookie` go out untouched from `handle`, a droplet's redirect is
  answered with its status, and their `Link` preloads go into
  `<svelte:head>`;
- `src/lib/shop.server.ts` is the framework-free part; `static/shop.css` is
  the layout, the same file in every host. Shop links reload the page
  (`data-sveltekit-reload`), as on every other host.

adapter-node needs `ORIGIN` (SvelteKit checks form posts against it) and a
`BODY_SIZE_LIMIT` above the 512 KB default for admin image uploads; the
compose file and the Dockerfile set them. Locally:

```bash
npm run build
ORIGIN=http://localhost:8006 BODY_SIZE_LIMIT=4M PORT=8006 node build
open http://localhost:8006/gallery
```

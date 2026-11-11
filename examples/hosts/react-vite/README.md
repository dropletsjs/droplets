# React (Vite SPA)

A single-page app has no server of its own, so it cannot paste fragments in
before the page ships. `src/droplets.tsx` is a `<Droplet>` component with two
modes:

- **`fragment`** (default): fetches `GET /droplets/<id>` from the browser and
  inserts the server-rendered HTML. The droplet's own JavaScript then hydrates
  it. Good for content that should be visible immediately.
- **`client`**: renders the droplet element (`<djs-svelte>`,
  the Svelte example's `element` setting; `VITE_DROPLETS_ELEMENT` overrides it)
  with `data-droplet` and `data-context` directly; it loads from where `/index.js` came from. The element fetches its data from `/droplets/<id>/_data`
  and mounts the component. Nothing shows until the bundle loads.

Either way, `ensureDropletsClient()` adds `/index.js` to the page once.

```bash
docker compose up --build
open http://localhost:8004
```

Without Docker, with a droplets server already running on port 8000:

```bash
npm install
npm run dev
```

Set `VITE_DROPLETS_URL` to point the app at a droplets server elsewhere. The
page and the droplets server are different origins, so the droplets server
runs with `cors: true`.

## The shop demo

`/gallery`, `/product/:slug`, `/login` and `/admin` render the shop demo
(`examples/shop`, see its `CONTRACT.md`) as client-rendered pages in the
layout every host in `examples/hosts/` shares (`src/shop/`; `src/shop/shop.css`
is a copy of the common one). A tiny history router (`src/router.ts`) picks
the shop or the basic page; `/` is still the Svelte example.

The shop is proxied under this app's origin, so its cart and admin cookies
are first-party and nothing is cross-origin: `/index.js`, `/droplets/*`,
`/assets/*` and `/api/*` go to the shop with a fixed
`x-droplet-location: http://localhost:8004`, never the client's Host. In the image,
nginx does it (`nginx.conf`, which answers every other route with
`index.html`); under `vite dev` and `vite preview`, `server.proxy` does, to
`SHOP_INTERNAL_URL` (default `http://localhost:8300`). The app's own build
output lives under `/app/`, so `/assets/*` stays the shop's.

Pages fetch their fragments from the browser (`redirect: "manual"`, inserted
only when the answer is HTML); the cart badge is the client-only
`<djs-shop data-droplet="shopping-cart">`, and the toasts the client-only
`<djs-shop data-droplet="toast-center">`, first in the layout. Login and the other forms are
full-page posts through the proxy: the shop's `303` and `Set-Cookie` reach
the browser as they are.

```bash
docker compose up --build
open http://localhost:8004/gallery
```

Without Docker, with the shop on port 8300 started with
`DROPLETS_TRUSTED_ORIGINS=http://localhost:8004`: `npm run dev`.

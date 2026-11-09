# Astro

`src/pages/index.astro` fetches `GET /droplets/<id>` in its frontmatter (so on the
server, per request thanks to `output: "server"`) and renders each fragment
with `<Fragment set:html>`. The page loads `/index.js` once, marked
`is:inline` so Astro leaves the external module alone.

```bash
docker compose up --build
open http://localhost:8005
```

Without Docker, with a droplets server already running on port 8000:

```bash
npm install
npm run dev
```

The page and the droplets server are different origins, so the droplets
server runs with `cors: true`.

## The shop demo

`/gallery`, `/product/:slug`, `/login` and `/admin` embed the shop
(`examples/shop`, see its `CONTRACT.md`), beside the basic page at `/`:

- `src/pages/index.js.ts` and `src/pages/{droplets,assets,api}/[...path].ts`
  proxy the shop's routes under this origin (`ALL`, bodies streamed), with a
  fixed `x-host` (`SHOP_PUBLIC_URL`), so its cookies are first-party;
- each page's frontmatter fetches its fragments with the browser's `Cookie`
  and the page's URL as `Referer`, passes their `Set-Cookie` on through
  `Astro.response`, answers a droplet's redirect as it is, and
  `src/layouts/Shop.astro` writes their `Link` preloads into the head;
- `src/lib/shop.ts` is the framework-free part; `public/shop.css` is the
  layout, the same file in every host.

The public origin is read at runtime: `SHOP_PUBLIC_URL` in the container's
environment, nothing at build. Astro's own cross-site form check
(`security.checkOrigin`) would need it at build: it compares `Origin` with
the request's URL, whose host it trusts only when `security.allowedDomains`
lists it, and that list is compiled into the server. So `astro.config.mjs`
turns that check off and `src/middleware.ts` runs the same check against
`SHOP_PUBLIC_URL`: a form-like `POST` (or one without a content type) from
any other origin gets a 403. The shop checks `Origin` again on its side
(`DROPLETS_TRUSTED_ORIGINS`).

```bash
docker compose up --build
open http://localhost:8005/gallery
```

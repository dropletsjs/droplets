# Next.js (App Router)

`app/(basic)/page.tsx` is a server component. It fetches `GET /droplets/<id>` for each
droplet with `cache: "no-store"` (fragments are per-request content) and emits
them with `dangerouslySetInnerHTML`. Its root layout loads `/index.js`
once.

```bash
docker compose up --build
open http://localhost:8007
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
group, with its own root layout) embed the shop (`examples/shop`, see its
`CONTRACT.md`):

- route handlers (`app/index.js`, `app/droplets/[[...path]]`,
  `app/assets/[...path]`, `app/api/[...path]`) proxy the shop's routes under
  this origin, bodies streamed, with a fixed `x-droplet-location` (`SHOP_PUBLIC_URL`), so
  its cookies are first-party;
- the pages are server components: they fetch fragments with the browser's
  `Cookie` and the page's URL as `Referer` (`lib/shop-page.tsx`) and render
  their `Link` preloads as `<link>` elements, which React puts in the head;
- `lib/shop.ts` is the framework-free part; `public/shop.css` is the
  layout, the same file in every host.

Two limits of server components, which this host cannot work around:

- **A fragment's `Set-Cookie` is dropped on a page render.** Next.js lets
  only Server Actions, Route Handlers and the `proxy`/middleware set
  cookies; `cookies().set()` in a server component throws, because the
  page streams and its headers may already be gone. The fragments are
  fetched inside the page, after the middleware has run, so their
  `Set-Cookie` has nowhere to go (`shopPage` logs a warning if one comes).
- **A droplet's redirect goes out as Next's 307**: `redirect()` does not
  take a status.

Neither matters to the shop today: every cookie it sets, and its `303`s,
come from a form post or an API call, and those go through the proxy (a
Route Handler), which passes them on untouched. A droplet whose `load` sets
a cookie on a plain `GET` would need its page served from a Route Handler
instead (fetch the fragments there, return the HTML as a `Response` with
their `Set-Cookie`), giving up React for that page.

```bash
docker compose up --build
open http://localhost:8007/gallery
```

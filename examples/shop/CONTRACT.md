# Shop: the contract for hosts

The shop is a droplets server (`pnpm build && pnpm start`, port 8300; the
image in `Dockerfile`). A host page embeds its droplets the usual way: fetch
`GET /droplets/<id>?<props>` on its server with `x-droplet-location`, paste
the fragment, load `/index.js` once. The element is `<djs-shop>`. A
client-only host writes `<djs-shop data-droplet="<id>" data-params='{…}'>`
instead.

Every prop arrives as a query parameter (or a `data-params` key). Unknown
keys are dropped, so a host may forward its whole page query to each
fragment. Bad values answer 400.

## Droplets

| id | Framework | Mode | Props |
| --- | --- | --- | --- |
| `product-filter` | Hono JSX | SSR, hydrates on the first interaction (`"interactive"`) | `q` (≤ 80), `category` (`""` or a slug), `sort` (`new` \| `price-asc` \| `price-desc`), `onSale` (`1`/`on`/`true`), `scope` (default `main`) |
| `product-library` | Svelte | SSR + hydrate | the filter's props, `page` (default 1), `pageSize` (12 \| 24) |
| `product-card` | Svelte | SSR, hydrates when visible | `slug` |
| `shopping-cart` | React | client-only (`ssr = false`) | `variant` (`badge` \| `inline`, default `badge`) |
| `product-page` | Handlebars | prerendered per product version, no JavaScript | `slug`, `v` (10 hex characters, optional) |
| `product-comments` | Solid | SSR, hydrates when visible; full oldest-first pages prerendered | `productId`, `order` (`oldest` \| `newest`), `page`, `showing` (10 \| 20 \| 25 \| 50) |
| `product-admin` | Vue | SSR + hydrate | `view` (`list` \| `new` \| `edit` \| `campaign`), `id` (with `edit`) |
| `login` | Hono JSX | SSR, no JavaScript | `next` (a path on the host, default `/admin`) |
| `toast-center` | Solid | client-only (`ssr = false`), hydrates on load (`hydrate = true`) | none |

`product-page` is built once per product, under the product's version `v`;
stock and the campaign price are filled in on every request (its
`transform`), so a stock change shows at once. An edit gives the product a
new `v`, so its page is never stale (see "Stale-free SSG with a version
prop" below). `product-comments`
serves full oldest-first pages from the build too; other orders and partial
pages render live. Neither render holds the comment count: it comes from
`/api/comments` after hydration.

## Pages a host builds

| Page | Droplets | Pass from the page's URL |
| --- | --- | --- |
| every page, once (first in `<body>` by convention) | `toast-center` | nothing |
| every page (header) | `shopping-cart` (`variant=badge`) | nothing |
| `/gallery` | `product-filter`, `product-library` | the whole query (`q`, `category`, `sort`, `onSale`, `page`) |
| `/product/:slug` | `product-page` (`slug`), `product-comments` (`productId`, from `/api/products` or the card) | `v` to the product page; `order`, `page`, `showing` to the comments |
| `/cart` (optional) | `shopping-cart` (`variant=inline`) | nothing |
| `/login` | `login` | `next` |
| `/admin` | `product-admin` | `view`, `id` |

Without JavaScript the filter and the library's sort are GET forms and the
pagers are plain links on the host's own URL: forward the query and they work.
`product-admin` renders a login prompt linking to `/login?next=/admin` when
the request has no admin session.

## Stale-free SSG with a version prop

`v` is a short hash of what the product page renders at build (its load's
data: name, description, details, image, category, related products), from
`pageVersions()` in `src/lib/server/products.ts`. Stock and prices are not
in it.

- `entries()` prerenders `{ slug, v }` with each product's `v` at build.
- Every link the shop builds carries the current `v` (`/product/<slug>?v=…`):
  the cards (`CardProduct.v`), the cart lines, the page's related products.
  An unedited product's link hits the stored page; after an edit the new
  `v` was never prerendered, so the page renders live.
- Without `v` the page always renders live: `/product/<slug>` is the
  canonical, shareable URL. A host's route must work without it.
- An old `v` answers `302` to the host page without `v`, its other
  parameters kept. The host passes that redirect on, as any fragment's.

All of it is in `transform`, which runs over the stored page and the live
one alike:

```ts
export const transform = async ({ html, props, host }: TransformEvent) => {
  const slug = String(props["slug"]);
  const [live, versions] = await Promise.all([liveValues(slug), pageVersions()]);
  if (!live) return `<p class="gone">This product is no longer available. …</p>`;

  // An old link: `host` is the host page (from the Referer its server sends).
  if (props["v"] !== undefined && props["v"] !== versions.get(slug)) {
    const canonical = new URL(host);
    canonical.searchParams.delete("v");
    redirect(302, canonical.href);
  }

  // %live:stock-label% → Out of stock
  // /product/linen-notebook%v:linen-notebook% → /product/linen-notebook?v=3f9a01c2d4
  return fillVersions(fillLive(html, live), versions);
};
```

The redirect's target comes from the `Referer` the host sends with each
fragment fetch (its page's URL, query included). nginx cannot pass a
redirect from an SSI include on: it fetches the fragment first
(`auth_request`) and redirects itself. The SPA cannot read an opaque
redirect: it replaces its URL with the one without `v`.

## Events, on `window`

| Event | detail | From → to |
| --- | --- | --- |
| `shop:filter` | `{ q, category, sort, onSale, scope }` | filter → the library with the same `scope` |
| `shop:cart-changed` | `{ count, cart? }` | anything that changed the cart → the cart badge |
| `shop:product-changed` | `{ id }` | admin → library, cards, cart |
| `shop:cart-open` | `{}` | a host's own button → the cart drawer |
| `droplets:action` | `{ droplet, action, type, status, data }` | an enhanced form, after each form action → the cart |

The host may dispatch any of them, and listen to them. Listeners check the
shape of `detail`; anything else is ignored.

## Messages for the visitor: `window.shopMessageQueue`

`/index.js` installs `window.shopMessageQueue`, the `toast-center` droplet
listens on it, and anything on the page may emit into it: the shop's
droplets, and the host page. It is a small EventEmitter
(`src/lib/message-bridge.ts`, no dependency) whose event names are the
message kinds:

```js
window.shopMessageQueue?.emit("toast", { type: "success", label: "Saved" });
```

| Kind | data |
| --- | --- |
| `toast` | `{ type: "success" \| "error" \| "info", label }`, `label` a non-empty string, cut to 140 characters |

- The interface: `on(event, listener)` (returns the queue, so calls chain),
  `once`, `off`, `emit(event, data)` (`true` when someone listened),
  `addListener` and `removeListener` (the same as `on` and `off`), and
  `listenerCount(event)`.
- `init` in `src/hooks.client.ts` installs it (`??=`): `/index.js` calls
  it before any droplet starts, so the queue is there before the first
  droplet hydrates, wherever the toast center sits. Place the droplet once
  per page; it hydrates on load, and the hosts put it first in `<body>`,
  though it does not have to be. Emit with `?.`: before `/index.js` ran
  nothing happens, and a toast emitted before the toast center loaded has
  no listener and is lost.
- A known kind's data is checked: plain data only (no class instance, no
  array, no getter), a known `type`, strings capped. Data out of shape is
  dropped. An unknown event passes through untouched for whoever listens
  for it. A listener that throws is reported (`console.error`); the other
  listeners still get the message.
- A `window.shopMessageQueue` that is already there and has no `on`, `off`
  and `emit` functions is never overwritten or called: `init` logs it and
  the toast center listens on nothing, so no toast shows.
- The product card sends the toast for its add (with the product's name);
  the product page has no JavaScript, so `init` relays its enhanced add
  from `droplets:action`. Without JavaScript there are no
  toasts: the page comes back with the button saying "✓ Added".

## HTTP API (JSON)

| Route | Notes |
| --- | --- |
| `GET /api/products?q&category&sort&onSale&limit&cursor` | `limit` 1–48, `nextCursor` is opaque; public, 10 s |
| `POST /api/stock/check` `{ ids }` | ≤ 50 product ids |
| `GET /api/cart` | the `cart_id` cookie's cart; private |
| `POST /api/cart/items` `{ productId, qty }`, `DELETE /api/cart/items/:productId` | the JSON twin of the cart actions, for SPAs |
| `GET /api/comments?productId&order&page&showing` | `{ comments, total, page, pageCount }`; public, 5 s |
| `GET /api/images/:key` | product images (`<slug>.webp`, uploads `u-<hash>.<ext>`) |
| `GET /api/auth/me` | `{ admin: { name } \| null }`; private |

## Proxy, headers and cookies

The cart and the admin session are cookies on the droplets origin, so the
browser must reach the shop through the host's origin. Proxy these paths to
the shop, unchanged:

- `/index.js`, `/assets/*`, `/droplets/*` (fragments, `_data`, form actions),
  `/api/*`.

For each proxied request and each server-side fragment fetch:

- Send `x-droplet-location: <the public origin>` and list that origin (and
  the host's own) in `DROPLETS_TRUSTED_ORIGINS` on the shop. The shop
  honours `x-droplet-location` only when its origin is trusted (its own, or
  in `DROPLETS_TRUSTED_ORIGINS`); otherwise it is ignored.
- Forward the browser's `Cookie` header on fragment fetches (`cart_id`,
  `shop_admin`): the cart, the admin list and the login state render from it.
- Pass `Set-Cookie` back untouched. The shop never sets `Domain`, so the
  cookies belong to whichever origin the browser sees.
- Fetch with `redirect: "manual"` and return 3xx as they are: the login
  answers 303 to `next` on the host.
- Form posts are checked against `Origin`: keep the browser's `Origin` and
  `Referer`. The shop reads the host page from `Referer` (a trusted origin
  only) to resolve relative redirects, and a post without JavaScript is sent
  back to that page.
- On each server-side fragment fetch, send the page's own URL, query
  included, as `Referer` (`<public origin><path>?<query>`): after a post
  without JavaScript the page's URL carries the signed result
  (`__droplet_form_<droplet>_<build>`), and the droplet reads it from there.
- Cookies are `HttpOnly`, `SameSite=Lax` and `Secure`, except over plain
  HTTP to `localhost`. A host on plain HTTP under another name loses them.
- Fragments with a cart or a session in them are `private, no-store`; the
  filter, comments and `GET _data` reads are publicly cacheable for seconds.

## Environment, on the shop

`cp .env.example .env` gives local demo values (`pnpm start` and `vite dev`
read `.env`). Never use them anywhere else.

| Variable | Used for |
| --- | --- |
| `ADMIN_USER`, `ADMIN_PASSWORD` | the one admin; compared in constant time |
| `SHOP_SECRET` | signs `shop_admin` (≥ 32 characters; without it login answers 503) |
| `SHOP_DATABASE` | the SQLite file (default `shop.db`; seeded by `pnpm seed`) |
| `SHOP_IMAGES`, `SHOP_UPLOADS` | image directories (default `images`, `.uploads`) |
| `DROPLETS_TRUSTED_ORIGINS` | the origins whose `x-droplet-location` and form posts are trusted, and the pages a post may be sent back to |
| `DROPLETS_SECRET` | signs the result of a form posted without JavaScript (≥ 32 bytes; without it such a post answers the fragment instead of a redirect back) |
| `PORT` | default 8300 |

## Generating the data

`data/*.json` and `images/` are committed; `pnpm seed` reads them and never
calls a model. The two scripts that wrote them are development tools, run once:

- `pnpm generate:data` writes the descriptions, details and comments with a
  local OpenAI-compatible server (it must support `json_schema` answers).
- `pnpm generate:images` writes `images/<slug>.webp` with a ComfyUI server,
  then `cwebp` (needed on the `PATH`) to ~800 px. It skips images that exist.

| Variable | Used for |
| --- | --- |
| `LLM_URL` | required by `generate:data`: the server's base URL, without `/v1` (e.g. `http://localhost:8000`) |
| `LLM_MODEL` | required by `generate:data`: the model the server serves |
| `COMFY_URL` | the ComfyUI server for `generate:images` (default `http://localhost:8188`) |
| `COMFY_UNET`, `COMFY_CLIP`, `COMFY_VAE` | the model files ComfyUI loads (default `zImageTurbo_turbo.safetensors`, `qwen_3_4b.safetensors`, `ae.safetensors`) |

## Form actions

Every form is a plain `<form method="post">` to its droplet's action
(`actionUrl()`), so the shop works without JavaScript. Once a droplet is
live, its forms are enhanced (opt-in, per form): `use:enhanceDropletForm`
on the product card, `useEnhanceDropletForm` in the cart and the admin's
`EnhancedForm`, `use:enhanceDropletForm` on the comment form and
`data-droplets-enhance` on the product page. An enhanced submit posts by
`fetch`, shows the result in place and dispatches `droplets:action` on
`window`; the cart listens for it after an `?/add`. An add's result is a
toast (see `window.shopMessageQueue`), never a message under the button. The login ships no
JavaScript and never enhances.

Without JavaScript a post answers `303` (Post/Redirect/Get): back to the
page it came from (its `Referer`, or the `__droplet_return` the action URL
names when the `Referer` is another page or the origin alone), with the
result signed in the query as
`__droplet_form_<droplet>_<build>=…`, or to where the action redirects (the
login's `next`). The host renders that page as any other, passing its URL as
`Referer`, and the droplet shows the result (the add button says `✓ Added`,
the login `Wrong user or password.`). The result is valid five minutes; the shop needs
`DROPLETS_SECRET` for it.

---
title: The HTTP contract
description: "Every route a droplets server exposes, the fragment's markup and Link header, x-host, CORS and caching."
---

A droplets server is an ordinary HTTP server. These routes are the whole
interface; anything that can make a request can host a droplet.

## Routes

| Route | Returns |
| --- | --- |
| `GET /droplets/:id` | The droplet as an HTML fragment, props from the query string (or `x-droplet-props`) |
| `POST /droplets/:id` | With a JSON body: the same fragment, props from `{ "host": "…", "props": { … } }` (`host` optional); the query string is never props here. With a form body: a [form action](#form-actions) |
| `GET`, `POST /droplets/:id/_data` | `{ "data": … }`: the server load only, no rendering; other methods answer `405` |
| `GET /droplets/:id/client.js` | That droplet's bundle; `404` when it never hydrates |
| `GET /droplets/:id/style.css` | That droplet's stylesheets, the shared one first, as `@import`s; empty when it has none |
| `GET /index.js` | A small stub that imports the entry client, which defines the droplet element, and carries the dynamic public env |
| `GET /index.css` | The shared stylesheet, for pages that want to link it themselves |
| `GET /assets/*` | The entry client, shared chunks, stylesheets and assets |
| `ALL /api/*` | Your [`+server.ts`](/guides/server/#api-routes) endpoints |
| `GET /health` | `ok`, for health checks (`health` option) |
| `GET /importmap`, `/importmap.js` | The [import map](/guides/server/#import-maps), when there are externals |
| `GET /` | The `index` page in production; the [devtools page](/guides/development/#the-devtools-page) in `vite dev` |

Unknown droplets answer `404`. A load that fails answers the error page with
`500` ([Errors](/guides/errors/)); `error()` and `redirect()` answer their own
status; props the schema refuses answer `400`.

Two query flags override the droplet's flags for one request: `?noSSR` skips
rendering but still runs the server load, and `?clientOnly` skips both.

## The fragment

`GET /droplets/hello?who=Ana` answers (formatted here; `djs-droplet` is the
default tag name):

```html
<djs-droplet data-droplet="hello" data-build="36a187" data-render-id="dfks2s">
  <script type="application/text" data-droplet-context>eyJ1cmwiOi…</script>
  <script type="application/text" data-droplet-data>eyJkYXRhIjp7…</script>
  <link rel="stylesheet" href="https://drops.example.com/droplets/hello/style.css?c=36a187" data-droplet-style>
  <div style="display: contents" data-droplet-entry>
    <h1>Hello Ana!</h1>
  </div>
</djs-droplet>
```

| Part | Meaning |
| --- | --- |
| `data-droplet` | The droplet id. |
| `data-build` | The build that rendered it; see [deploys while a page is open](/guides/errors/#deploys-while-a-page-is-open). |
| `data-render-id` | The id of this server render, for engines that key hydration by it. |
| `data-droplet-error` | Present when the markup is the error page. |
| `data-context` | The context as an attribute, when there is no inline `data-droplet-context`. |
| `data-droplet-context` | Base64 JSON `{ host, props }`, after the props schema: where it renders, and its props. Sent back when the browser needs `_data`. |
| `data-droplet-data` | Base64 JSON envelope, `{ "data": … }` or `{ "error": … }`. Its presence tells the browser the server load ran. Absent for droplets that never hydrate and for `clientOnly`. |
| `link[data-droplet-style]` | The droplet's `style.css`, inside the element, ahead of its markup, so the markup never shows unstyled and nothing goes into the host's `<head>`. Absent when the droplet has no styles. |
| `[data-droplet-entry]` | The server-rendered markup. The browser hydrates it in place. |

A host adds its own content as one `<div data-droplet-slot>` before the closing
tag; see [Host children](/guides/in-the-browser/#host-children). Hand-written
`data-droplet-data` must use the envelope.

Once `/index.js` has run on the page, every element takes care of itself; see
[In the browser](/guides/in-the-browser/). The markup never says where to load
from: the browser loads JavaScript, CSS and data from where `/index.js` came
from.

### The `Link` header

Every fragment (`GET` and `POST`, live or [prerendered](/guides/writing-droplets/#prerendering),
the error page too) names what the browser will ask for next, as absolute URLs
on the public origin:

```
Link: <https://drops.example.com/droplets/hello/style.css?c=36a187>; rel=preload; as=style,
      <https://drops.example.com/assets/Badge-BR92zFkG.css>; rel=preload; as=style,
      <https://drops.example.com/assets/hello-B1eNVDFs.css>; rel=preload; as=style,
      <https://drops.example.com/assets/index.C-iXBKI0.js>; rel=modulepreload,
      <https://drops.example.com/droplets/hello/client.js?c=36a187>; rel=modulepreload
```

- `preload` for `style.css` and every stylesheet it imports, when the droplet
  has styles;
- `modulepreload` for the entry client that `/index.js` imports;
- `modulepreload` for the droplet's bundle when it hydrates at once
  (`hydrate = true`, the default), the error page included, since it hydrates
  from the same bundle. A droplet that never hydrates, or waits for
  `"visible"` or `"interactive"`, gets none.

A host that passes the header on with its own page (or sends it as `103 Early
Hints`) lets the browser start these downloads before it reaches the element.
Several fragments on one page: join their headers with `, `. Nothing breaks
when the header is dropped; the downloads just start later. `vite dev` sends
no `Link` header: there, component styles come with the JavaScript.

## `style.css`

`GET /droplets/:id/style.css` answers one `@import` per stylesheet the
droplet needs: those of the components it shares with other droplets first,
then its own. The paths are relative, so they resolve under whatever origin
or path prefix the server is reached through:

```css
@import url("../../assets/Badge-BR92zFkG.css");
@import url("../../assets/hello-B1eNVDFs.css");
```

It is served for droplets that never hydrate as well, and is empty for a
droplet without styles (and in `vite dev`, where styles come with the
JavaScript).

## `_data`

`GET` or `POST /droplets/:id/_data` runs the props schema and the server load,
and answers `{ "data": … }`, or `{ "error": … }` with a `500` when the load
failed. When `host` carries a no-JavaScript action's result for the droplet,
it is `{ "data": …, "form": … }` ([Post/Redirect/Get](#postredirectget)). `error()` and `redirect()` answer as they would for the fragment.
Answers carry `x-droplets-build`. Other methods answer `405`.

The two methods are for different callers:

- **`POST` is what the browser sends.** Props come from the body's context
  only, `{ "host": "…", "props": { … } }`, with no query string but a
  cache-buster (`__cb`); the page's own query is never forwarded. The
  browser requests it only for droplets with `+droplet.server.ts`, only when
  no data came inline, and never follows a redirect.
- **`GET` is the public read.** Props come from the query string (or
  `x-droplet-props`), `host` from the request's headers. It is the one to
  open in a browser, call from a tool or a test, and the one a CDN can
  cache: a load that is the same for everyone says so with
  [`setHeaders`](/guides/writing-droplets/#setheaders).

```ts
// src/droplets/products/+droplet.server.ts
export const load = async ({ props, setHeaders }: LoadEvent) => {
  setHeaders({ "cache-control": "public, max-age=60" });
  return { products: await db.products(props.category) };
};
```

```
GET /droplets/products/_data?category=mugs
→ 200, cache-control: public, max-age=60
  { "data": { "products": [ … ] } }
```

## `x-host`: the public location

The URLs a fragment writes (its `style.css` link, the `Link` header) point
where the **browser** reaches the droplets server. By default that is the
request's own origin, which is wrong as soon as a proxy or a host application
sits in between: the host reaches the droplets server at
`http://droplets:8000` inside Docker, but browsers reach it at
`https://drops.example.com`.

Send the browser-facing URL in the `x-host` header when fetching a fragment,
and list its origin in [`trustedOrigins`](/guides/configuration/) (or
`DROPLETS_TRUSTED_ORIGINS`):

```
GET /droplets/hello?who=Ana
x-host: https://drops.example.com
```

```ts
// droplets.config.ts
import { config } from "@dropletsjs/droplets";

export default config({ trustedOrigins: ["https://drops.example.com"] });
```

`x-host` is honoured only when its origin is the request's own or listed in
`trustedOrigins` (`"*"` does not count); otherwise it is ignored, with a
warning in the log, and the request's origin is used. Anyone can send the
header, and it decides the URLs the server writes about itself: with a cache
in front, one request with `x-host: https://evil.example` would otherwise
leave a fragment whose stylesheet, `Link` preloads and form actions point at
the attacker, served to everyone. The proxy or host must **overwrite**
`x-host` with a fixed value, never pass on a client's, and the droplets
server should not be reachable around it.

A path prefix is kept: `x-host: https://shop.example/mfe/` puts every URL
under `https://shop.example/mfe`. The value must be an `http:` or `https:`
URL; credentials, query and hash are dropped, and anything else (`data:`,
`javascript:`, a bare word) is ignored in favour of the request's own origin.
`request.url` in `handle` and `+server.ts` uses the same location.

`x-host` only shapes the URLs the server writes. The browser takes its own
location from `/index.js`: the elements load JavaScript, CSS and data from
the URL the page loaded `/index.js` from, prefix included, whatever the
markup says. Point the `<script src>` at the same place as `x-host`.

## `host`: where the droplet renders

`x-host` says where the droplet **lives**; `host` in load events says where it
**renders**: the host page. A host tells it, first match wins:

1. `"host"` in a POST body: `{ "host": "https://shop.example/product/mug", "props": { … } }`;
2. `Forwarded: proto=https;host=shop.example` (RFC 7239);
3. `X-Forwarded-Host: shop.example` with `X-Forwarded-Proto: https`;
4. `Origin`, as browsers send it;
5. else the request's own origin.

Headers carry no path, so `host.pathname` is `/` unless a body gave one, or
`handle` read it from `Referer` or `X-Forwarded-Uri`; see
[`host`](/guides/writing-droplets/#host). A proxy that forwards the page's
request (nginx with `proxy_set_header X-Forwarded-Host $host`) needs nothing else.

Only `http:` and `https:` URLs count, without credentials or hash; a source
with anything else is skipped for the next one, never an error. With
[`trustedOrigins`](/guides/configuration/) set, a `host` whose origin is
neither in the list nor the server's own falls back to the server's origin.

`host`, `x-host` and the props come from the request: any client can send
any value. Use them to render, never to decide who may see what; that is the
job of cookies or a token checked in `handle`. A response shaped by them is
per request, which is why fragments are [not cached](#caching) by default.

### Who sees what

Embedding a droplet tells its server where it renders: the page's URL, path
and query, in `host`. It is the same trust you give a third-party script on
the page. A droplet served by someone else sees the URLs of the pages it is
embedded in, query strings included; do not embed droplets you do not trust
on pages whose URLs carry anything sensitive. The
[Security model](/guides/security/) gathers the rest of what a droplets
server trusts.

## CORS

When the host page and the droplets server are on different origins, the
browser needs permission to import `/droplets/<id>/client.js` as a module and
to `POST` to `/droplets/<id>/_data` with a JSON body. Set `cors: true` in
`droplets.config.ts`, or pass an origin list. Stylesheets need no CORS. With
CORS on, `Access-Control-Expose-Headers` always includes `Link` and
`x-droplets-build`, on top of any `exposeHeaders` you pass. The
[nginx example](/integrate/hosts/nginx/) avoids CORS entirely by proxying the
droplets routes under the host's own origin.

## Form actions

`POST /droplets/:id` decides by its body's content type:

| Body | What happens |
| --- | --- |
| `application/json` | The fragment renders, as above. With a `?/name` key: `400`. A `form` key renders it with that `form` (for a droplet with `actions`; ignored otherwise): how an enhanced form swaps in a droplet that does not hydrate. It is client input, as props are. |
| `application/x-www-form-urlencoded`, `multipart/form-data` | An action: the query key that starts with `/` names it (`?/add`), none is `default`. |
| `text/plain` | `415`. |

The `Origin` check and the body limits come first. Then the droplet, its
`actions` export and the name are resolved, and only then is the body read,
by the action itself:

| Case | Status |
| --- | --- |
| The droplet has no `actions` | `405`, `allow: GET`; the body is never read |
| No such action: a name that is not an own function of `actions`, or not `[A-Za-z_][\w-]*` (`__proto__`, `constructor`…) | `404` |
| More than one `?/name` | `400` |
| `actions` is not a plain object | `500` |
| Props the schema refuses | `400` |

Props come from the query string, or `x-droplet-props`; `?/name`,
`__droplet_return` and any `__droplet_form_*` key are never props, and every other key stays as it
came in `request.url`. The URL is the same for every caller; the request
decides the answer. One that accepts JSON (an enhanced form, or any script)
gets the result; anything else is a native form post, answered
Post/Redirect/Get ([below](#postredirectget)). What the action returns is
answered:

| Result | `accept: application/json` | Otherwise, with `DROPLETS_SECRET` | Otherwise, without it |
| --- | --- | --- | --- |
| data, or nothing | `200` `{ "type": "success", "status": 200, "data": … }` | `303` back to the page, the result in its query | `200`, the fragment rendered again with `form` |
| `fail(status, data)` | `status` `{ "type": "failure", "status": …, "data": … }` | `303` back to the page, the result in its query | `status`, the fragment with `form` |
| `redirect(status, location)` | `200` `{ "type": "redirect", "status": …, "location": "…" }` | `303`, `location` | `303`, `location` |
| `error(status)` | `status`, `{ "message": … }` | `status`, the message | `status`, the message |
| data that is not plain JSON | `500` | `500` | `500` |

Action URLs (`actionUrl()` of `$droplets/form`, `{{action}}` in Handlebars)
are `<location>/droplets/<id>?/<name>&<props>&__droplet_return=<page>`, the
same on the server, in the browser and in a prerender, on the
[public location](#x-host-the-public-location): a trusted `x-host`, never an
untrusted one, and a per-request token in a prerendered render. `<page>` is
the page the form is on, its origin and path, encoded: `host` on the server
(the host tokens in a prerender, filled per request), `window.location` in
the browser.

`location` is absolute, resolved against `host`. A fragment rendered with
an action's result is rendered live, never from the prerendered renders,
with the result in its inline data next to `data` (`{ "data": …, "form": … }`)
so it hydrates with the same `form`. What the action (and, for a fragment,
the load that follows) sets with `setHeaders` and `cookies` goes out on
every answer but an error, the `303`s included.

### Post/Redirect/Get

A native post goes back to the host page, so a reload never posts again:

| Case | Answer |
| --- | --- |
| success or `fail()` | `303`, `location`: the page (below) without its `#hash`, its `?/name`, `__droplet_return` and `__droplet_form_*` keys, plus `__droplet_form_<droplet>_<build>=<result>` |
| `redirect()` | `303`, `location`: its target |
| no page that passes: neither `__droplet_return` (once, 2 KB at most) nor `Referer` names one whose origin is this server's (a trusted `x-host`'s included) or in `trustedOrigins`, outside `<location>/droplets/` | `400`, plain text; the action does not run |
| a `redirect()` to such an origin, `javascript:` or anything but `http(s)` | `400`, plain text |
| no `DROPLETS_SECRET` (or under 32 bytes) | the fragment rendered with `form`, as the table above; a warning in the log, once |

The page, read from the URL and the headers before the body: the
`Referer` when it has the origin and path `__droplet_return` names (its
query comes back with it); else `__droplet_return` (origin and path only);
else the `Referer` alone. A cross-origin page's `Referer` is its origin
alone under the browsers' default policy, so `__droplet_return` carries the
path. Origins are compared exactly, `http:` and `https:` only, and `"*"` in
`trustedOrigins` never counts here: it lets every origin post, never sends
the browser anywhere. The result is
`base64url(JSON { status, data?, exp, action })`, a `.`, and
`base64url(HMAC-SHA256)` over a version tag, the droplet, the build, the
page's origin and path, and that JSON, keyed with `DROPLETS_SECRET`. It is valid for five minutes and at most
2 KB; past that, `data` is dropped (status and action stay) with a warning.

The page loads again. Any render of that droplet whose `host` carries a
genuine result for it (the fragment, `GET` or `POST`, and `_data`) renders
live with its `data` as `form`, `200`, `cache-control: private, no-store`;
`_data` answers `{ "data": …, "form": … }`. The value is checked before it is
read: its length and shape, then the MAC (`crypto.subtle.verify`), then the
JSON (plain `JSON.parse`, objects copied without prototypes, `__proto__`
dropped), the expiry and an action the droplet exports. The MAC is checked
against `host`'s origin and path: a result minted for one page is ignored
on any other. A value that fails
any of it is ignored. The keys are taken out of `host` before `handle` runs
(and again after it, for a `host` it set): no code of the app sees them.

`host` must carry the page's query for this to work: a host fetching
fragments on its server sends its page's URL as `"host"` in a `POST`
render, or as `Referer` for a `handle` that reads it with `hostFrom`; the
browser sends the page's URL with `_data` on its own. See
[Without JavaScript](/guides/writing-droplets/#without-javascript-postredirectget).

## Form posts: the `Origin` check

A page on another site can make the browser post a form to your server, with
the user's cookies and without asking CORS first: a `POST`, `PUT`, `PATCH`
or `DELETE` whose body is form-urlencoded, multipart or `text/plain`, or has
no content type at all. Such a request to `/droplets/*` or `/api/*` is
answered `403` before `handle` runs, unless its `Origin` header is:

- the server's own origin, or a trusted `x-host`'s, or
- in `trustedOrigins` in `droplets.config.ts`, or in the
  `DROPLETS_TRUSTED_ORIGINS` environment variable (comma-separated, read at
  runtime, added to the config's list); `"*"` trusts every origin.

A form submission without an `Origin` is refused too: every browser sends
one. So is `Origin: null`, what a browser sends from a page with
`Referrer-Policy: no-referrer`: such a page needs
`<meta name="referrer" content="strict-origin-when-cross-origin">` for its
forms to post here (see
[Post/Redirect/Get](/guides/writing-droplets/#without-javascript-postredirectget)).
A request without a content type and without an `Origin` passes: that
is another server calling, not a browser. This is SvelteKit's `csrf.checkOrigin`; `csrf: { checkOrigin: false }`
turns it off. JSON bodies and `GET`s are not checked: a JSON post from
another origin needs a CORS preflight, which `cors` answers. Behind a proxy
that rewrites the request, send `x-host` or list the public origin in
`trustedOrigins`.

## Body limits

Bodies over a limit answer `413` before `handle` runs, judged by
`content-length` or counted as they stream: 1 MB of JSON, 1 MB of
form-urlencoded or `text/plain`, 10 MB of multipart or anything else. An
`x-droplet-props` header over 8 KB answers `431`; send larger props in a
`POST` body. Change them with `limits` in `droplets.config.ts`.

## Cookies

What `handle` or a `+server.ts` handler sets with
[`event.cookies`](/guides/server/#cookies) goes out as `Set-Cookie` on the
response that answers the request: the fragment, `_data` or the endpoint,
also an error, a redirect or a response the handler built itself. A
[form action](#form-actions) sets them too. A droplet's `load` and
`transform` only read cookies: `cookies.set()` and `cookies.delete()` throw
there.

Cookies reach the browser in one of two ways:

- **same origin**: proxy the droplets routes under the host's own origin (the
  [nginx example](/integrate/hosts/nginx/)); the browser sends and receives them
  directly;
- **forwarded by the host**: a fragment fetched by the host's server delivers
  its `Set-Cookie` to that server, not to the browser. The host passes it on
  with its page, and forwards the browser's `Cookie` header when it fetches
  fragments. It never passes on a `Domain` attribute: the cookie belongs to
  the host's own origin.

A host's server fetching fragments should not follow redirects
(`fetch(url, { redirect: "manual" })`): a redirect is the droplet's answer,
for the host to pass on, and following it would make the host's server
request a URL someone else chose.

## Caching

Droplet bundles, stylesheets and everything under `/assets/` are sent with
`cache-control: public, max-age=2592000, immutable`. Files under `/assets/`
are content-addressed; for the routes, every build gets a short hash, appended
to their URLs as `?c=<hash>`, so a deploy invalidates them.

`/index.js` is the exception: a small stub, always `no-store`, that imports
the entry client under a name unique to the build, relative to its own URL:

```js
((globalThis[Symbol.for("droplets.servers")] ??= {})["my-widgets:a151d9"] ??= {}).origin = new URL(/* @vite-ignore */ ".", import.meta.url).href.replace(/\/$/, "");
((globalThis[Symbol.for("droplets.servers")] ??= {})["my-widgets:a151d9"] ??= {}).env = {"PUBLIC_BANNER":"…"};
import("./assets/index.C-iXBKI0.js");
```

The first line records where the page loaded `/index.js` from, prefix
included: the elements load from there. The second is there only when
`src/env.ts` declares dynamic public variables (`{ public: true }`): their
current values. Both live under `<element>:<build>`. Servers sharing a page
already need distinct `element` names, so each keeps its own values; the
build hash tells two builds of one server apart. `$droplets/drop` reads the
server's origin from the same record.

`/index.js` must be served by the droplets server, under its prefix: its own
URL is what the browser trusts. A CDN in front of it, pulling from the
server at the same URL, works; a copy uploaded elsewhere would make the
elements load from there.

A page that loads `/index.js` always learns about the newest build, and on a
reload only those few bytes go over the network: the entry itself comes from
the cache.

Fragments and `_data` are sent with `cache-control: private, no-store` by
default: they depend on the request's host, props and cookies, so a shared
cache must not keep them. The droplet decides otherwise, from its load:

```ts
export const load = ({ setHeaders }: LoadEvent) => {
  setHeaders({ "cache-control": "public, max-age=60" });
  return { … };
};
```

Its `Cache-Control` replaces the default, on the fragment and on `_data`;
an error answer, or a load that failed, keeps the default. A prerendered
render is served with the headers its load set at build. `handle` has the
last word: a `Cache-Control` it sets on the response stands.
`fragmentCacheControl` in `droplets.config.ts` changes the default for every
droplet, or `false` sends none.

Every fragment and `_data` answer carries
`Vary: x-host, forwarded, x-forwarded-host, x-forwarded-proto, origin`,
after any `Vary` the load set. A cache keys the answers it keeps by URL;
`Vary` adds these headers to the key. They are what the answer's URLs and
`host` come from, so a request with a spoofed one lands in a cache entry of
its own: it can poison only the answer it gets itself, never the one
everybody else is served.

The import map is not cached by the server. Cache fragments in your host if
their content allows it.

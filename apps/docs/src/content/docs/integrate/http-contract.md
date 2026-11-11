---
title: The HTTP contract
description: "Every route a droplets server exposes, the fragment's markup and Link header, x-droplet-location and host, form actions, the Origin check and body limits."
---

A droplets server is an ordinary HTTP server. These routes are the whole
interface; anything that can make a request can host a droplet.

## Routes

| Route | Returns |
| --- | --- |
| `GET /droplets/:id` | The droplet as an HTML fragment, props from the query string (or `x-droplet-props`) |
| `POST /droplets/:id` | With a JSON body: the same fragment, props from `{ "host": "…", "props": { … } }` (`host` optional: the page the droplet renders on, for a server-to-server request that has no browser `Origin` or `Referer`); the query string is never props here. With a form body: a [form action](#form-actions) |
| `GET`, `POST /droplets/:id/_data` | `{ "data": … }`: the server load only, no rendering; other methods answer `405` |
| `GET /droplets/:id/client.js` | That droplet's bundle; `404` when it never hydrates |
| `GET /droplets/:id/style.css` | That droplet's stylesheets, the shared one first, as `@import`s; `404` when it has none (nothing links to it then) |
| `GET /index.js` | A small stub that imports the entry client, which defines the droplet element, and carries the dynamic public env |
| `GET /index.css` | The shared stylesheet, for pages that want to link it themselves; `404` when there is none or it is empty |
| `GET /assets/*` | The entry client, shared chunks, stylesheets and imported files, cached for good |
| `GET /assets/public/*` | The project's `public/` folder, `no-cache` with an `ETag` (`304` when `If-None-Match` matches) |
| `ALL /api/*` | Your [`+server.ts`](/guides/server/#api-routes) endpoints |
| `GET /health` | `ok`, for health checks (`health` option) |
| `GET /importmap`, `/importmap.js` | The [import map](/guides/server/#import-maps), when there are externals |
| `GET /` | The `index` page in production; the [devtools page](/guides/development/#the-devtools-page) in `vite dev` |

Header names follow one rule: what a request sends is singular,
`x-droplet-*` (`x-droplet-location`, `x-droplet-props`); what a response
sends is plural, `x-droplets-*` (`x-droplets-build`).

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

Every fragment (`GET` and `POST`, live or [prerendered](/guides/prerendering/),
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

## `x-droplet-location`: the public location

The droplets server's location is where the **browser** reaches it: the
origin, and the path prefix if there is one, under which the browser loads
`/index.js`, `/droplets/*`, `/assets/*` and `/api/*`:

- the host's own origin when the host proxies those paths
  (`https://www.example.com`), as every [known host](/integrate/hosts/overview/) does;
- the droplets server's public URL when the page loads `/index.js` from it
  directly (`https://drops.example.com`).

It differs from `Host`. `Host` is the address the request was sent to, so it
says where the **host's server** reached the droplets server:
`Host: droplets:8000` inside Docker, `Host: localhost:8000` on one machine.
Taken from `Host` alone, the location is one the browser cannot reach. It
also differs from `host` in a load, which is the page the droplet renders
on ([below](#host-where-the-droplet-renders)).

What the location decides: every URL the fragment writes about the server
(its `style.css` link, the `Link` header, action URLs, `droplet.origin`),
the origins the [`Origin` check](#form-posts-the-origin-check) accepts as
its own, and `request.url` in `handle` and `+server.ts`.

### Where it comes from

The server works it out once per request. The first of these that parses
and is trusted wins:

1. `x-droplet-location`: one URL, its path the prefix
   (`x-droplet-location: https://shop.example/mfe`);
2. `Forwarded` (RFC 7239), its first element's `proto` and `host`, the prefix
   from `X-Forwarded-Prefix`;
3. `X-Forwarded-Proto` and `X-Forwarded-Host`, their first values, with
   `X-Forwarded-Port` when the host has no port of its own, the prefix from
   `X-Forwarded-Prefix`;
4. the [`origin`](/guides/configuration/#the-public-location) entry, when exactly one is
   configured;
5. the request's own origin.

A host that fetches fragments on its server sends `x-droplet-location`. A
reverse proxy needs nothing new: the forwarded headers it already sets are
read, or the droplets server has its public URL in `origin`
(`DROPLETS_ORIGIN`), and no header at all.

```
GET /droplets/hello?who=Ana
x-droplet-location: https://drops.example.com
```

```ts
// droplets.config.ts
import { config } from "@dropletsjs/droplets";

export default config({ origin: "https://drops.example.com" });
```

### Trust

Any client can send these headers, and the location decides the URLs the
server writes about itself. A location from a header (1 to 3) is used only
when its origin is:

- the request's own, or
- in [`origin`](/guides/configuration/#the-public-location) (or `DROPLETS_ORIGIN`), or
- in [`trustedOrigins`](/guides/configuration/#options) (or `DROPLETS_TRUSTED_ORIGINS`).

One that is not is skipped for the next, with a warning in the log, once
per header. Without any list, forwarded headers count only when they name
the request's own origin. `"*"` in either list trusts any location; see
[Trusting any location](/guides/security/#trusting-any-location) before
you use it.

The allow-list is the guard that matters. Fragments answer
`Vary: x-droplet-location, forwarded, x-forwarded-host, x-forwarded-proto, x-forwarded-port, x-forwarded-prefix, origin`
when they are cacheable, but CDNs ignore `Vary` on custom headers (most
only honour `Accept-Encoding`), so a shared cache can still hand one
request's fragment to everyone. With a location that is not on the list,
that fragment would point its stylesheet, `Link` preloads and form actions
at the attacker. The proxy or host should still **overwrite** these headers
with fixed values (or clear them), never pass on a client's, and the
droplets server should not be reachable around it.

The first value of a forwarded header is read, never a later one: the
first proxy wrote it, the ones after it only appended. The value must be an
`http:` or `https:` URL; credentials, query and hash are dropped, and
anything else (`data:`, `javascript:`, a bare word, a host with a path or
`@` in it) is skipped. A prefix must start with `/`, have no `//`, `\`,
`..`, `?`, `#` or control characters, be 256 characters at most, and keep
the origin once joined to it; a prefix that is not is dropped, and the
location is the origin alone. `x-droplet-location: https://shop.example/mfe/`
puts every URL under `https://shop.example/mfe`.

The location only shapes the URLs the server writes. The browser takes its
own location from `/index.js`: the elements load JavaScript, CSS and data
from the URL the page loaded `/index.js` from, prefix included, whatever the
markup says. Point the `<script src>` at the same place.

## `host`: where the droplet renders

The location says where the droplet **lives**; `host` in load events says
where it **renders**: the host page. A host tells it, first match wins:

1. `"host"` in a POST body: `{ "host": "https://shop.example/product/mug", "props": { … } }`;
2. `Origin`, as browsers send it;
3. else the origin of the droplets server's [location](#x-droplet-location-the-public-location).

`Origin` carries no path, so `host.pathname` is `/` unless a body gave one,
or `handle` read it from `Referer` or `X-Forwarded-Uri`; see
[`host`](/guides/writing-droplets/#host).

Only `http:` and `https:` URLs count, without credentials or hash; a source
with anything else is skipped for the next one, never an error. With
[`trustedOrigins`](/guides/configuration/) set, a `host` whose origin is
neither in the list nor the server's own falls back to the location's origin.

`host`, the location headers and the props come from the request: any client can send
any value. Use them to render, never to decide who may see what; that is the
job of cookies or a token checked in `handle`. A response shaped by them is
per request, which is why fragments are [not cached](#caching) by default.

### Who sees what

What a droplets server learns about the pages that embed it is in
[Who sees what](/guides/security/#who-sees-what).

## CORS

A page on another origin needs `cors` on the droplets server: see
[CORS](/guides/security/#cors).

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
| `redirect(status, location)` | `200` `{ "type": "redirect", "status": …, "location": "…" }`, `location` absolute | `303`, `location` | `303`, `location` |
| `redirect()` off the server's own origins and `trustedOrigins` | `400` `{ "message": … }` | `400`, plain text | `400`, plain text |
| `error(status)` | `status`, `{ "message": … }` | `status`, the message | `status`, the message |
| data that is not plain JSON | `500` | `500` | `500` |

Action URLs (`actionUrl()` of `$droplets/form`, `{{action}}` in Handlebars)
are `<location>/droplets/<id>?/<name>&<props>&__droplet_return=<page>`, the
same on the server, in the browser and in a prerender, on the
[public location](#x-droplet-location-the-public-location), never an
untrusted header's, and a per-request token in a prerendered render. `<page>` is
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
| no page that passes: neither `__droplet_return` (once, 2 KB at most) nor `Referer` names one whose origin is this server's (its location's included) or in `trustedOrigins`, outside `<location>/droplets/` | `400`, plain text; the action does not run |
| a `redirect()` to such an origin, `javascript:` or anything but `http(s)` | `400`, plain text (`400` `{ "message": … }` to a request that accepts JSON: the same check) |
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
[Without JavaScript](/guides/actions/#without-javascript-postredirectget).

## Form posts: the `Origin` check

A page on another site can make the browser post a form to your server, with
the user's cookies and without asking CORS first: a `POST`, `PUT`, `PATCH`
or `DELETE` whose body is form-urlencoded, multipart or `text/plain`, or has
no content type at all. Such a request to `/droplets/*` or `/api/*` is
answered `403` before `handle` runs, unless its `Origin` header is:

- the server's own origin, or its [location](#x-droplet-location-the-public-location)'s, or
- in `trustedOrigins` in `droplets.config.ts`, or in the
  `DROPLETS_TRUSTED_ORIGINS` environment variable (comma-separated, read at
  runtime, added to the config's list); `"*"` trusts every origin.

A form submission without an `Origin` is refused too: every browser sends
one. So is `Origin: null`, what a browser sends from a page with
`Referrer-Policy: no-referrer`: such a page needs
`<meta name="referrer" content="strict-origin-when-cross-origin">` for its
forms to post here (see
[Post/Redirect/Get](/guides/actions/#without-javascript-postredirectget)).
A request without a content type and without an `Origin` passes: that
is another server calling, not a browser. This is SvelteKit's `csrf.checkOrigin`; `csrf: { checkOrigin: false }`
turns it off. JSON bodies and `GET`s are not checked: a JSON post from
another origin needs a CORS preflight, which `cors` answers. Behind a proxy
that rewrites the request, put the public URL in `origin` (or
`DROPLETS_ORIGIN`), or list the page's origin in `trustedOrigins`.

## Body limits

Bodies over a limit answer `413` before `handle` runs, judged by
`content-length` or counted as they stream: 1 MB of JSON, 1 MB of
form-urlencoded or `text/plain`, 10 MB of multipart or anything else. An
`x-droplet-props` header over 8 KB answers `431`; send larger props in a
`POST` body. Change them with `limits` in `droplets.config.ts`.

## Cookies

How `Set-Cookie` gets from a fragment, `_data`, an action or an endpoint to
the browser, and what a host passes on, is in
[Cookies](/guides/security/#cookies).

## Caching

What each route sends as `Cache-Control` and `Vary`, and how `/index.js`
picks up a new build, is in [Caching](/guides/security/#caching).

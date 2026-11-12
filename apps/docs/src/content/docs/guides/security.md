---
title: Security model
description: "What a droplets server trusts, who sees what, and the rules for the droplet location, caching, CSRF, CORS, cookies, limits, server-only code, signed form results and request input."
---

This page gathers the rules spread over the guides, in one place. Each
section links to where the details live.

## The trust model

A droplet renders inside pages its server does not own, and those pages
call it with whatever they like. Two things follow:

- **The droplets server trusts the host page's operator, not the request.**
  Everything a request carries is input: `host`, the location headers, the props, the
  form body, the cookies. Render with it; never decide from it who may see
  or do what. That is the job of a session cookie or a token checked in
  `handle` and the actions.
- **The host page trusts the droplets server like a third-party script.**
  The fragment's markup and the bundles run on its page with its origin's
  rights. Embed droplets only from servers you would let run a script on
  that page.

### Who sees what

Embedding a droplet tells its server where it renders: the page's URL,
path and query, in [`host`](/guides/server/#host). A host page's server
that fetches fragments sends it (as `"host"` in a `POST` render,
or as `Referer`); the browser sends it with `_data`. A droplets server run
by someone else therefore sees the URLs of the pages it is embedded in,
query strings included. Do not embed droplets you do not trust on pages
whose URLs carry anything sensitive (a reset token, a search, an id).

What does not cross:

- the page's query is never forwarded as props: the browser's `_data`
  request carries props from the element's context only, and only a
  `__cb` cache-buster in its query;
- `locals` are never serialized into a fragment;
- a private environment variable never reaches the browser unless a load
  returns it (see [Server-only code](#server-only-code)).

## The droplet location and `host`

The droplet location is where the browser reaches the droplets server; it decides
the URLs a fragment writes about itself (its stylesheet, its `Link`
preloads, its action URLs) and the origins its form posts may come from.
It comes from `x-droplet-location`, else `Forwarded`, else
`X-Forwarded-Proto` with `X-Forwarded-Host` (and `X-Forwarded-Prefix`).
Anyone can send those headers, so:

- a header's location is used only when its origin is the request's own
  or in `trustedOrigins` / `DROPLETS_TRUSTED_ORIGINS`. An untrusted one is
  skipped (with a warning under `vite dev`), and never reaches an action
  URL. Without a list, forwarded headers count only when they name the
  request's own origin;
- it must be an `http:` or `https:` URL; credentials, query and hash are
  dropped, and a path prefix with `//`, `\`, `..`, `?`, `#` or control
  characters, or over 256 characters, is dropped too;
- of a forwarded header only the first value counts, the one the first
  proxy wrote;
- the proxy or host page's server in front **overwrites** these headers with fixed
  values, or clears them, never passing on a client's; and the droplets
  server is not reachable around that proxy.

With no trusted header, the location is the request's own origin. See
[`x-droplet-location`](/integrate/http-contract/#x-droplet-location-the-droplet-location).
With [`location`](/guides/configuration/#a-fixed-location) set, there is
nothing to trust: every request's location is `location`, and no header is
read.

`host` (where the droplet renders) is taken from the request too: a render
body, then `Origin`, then the location's origin. With `trustedOrigins` set,
a `host` outside it (and not this server) becomes the location's origin.
With [`host`](/guides/configuration/#a-fixed-host) set, it is that origin,
with the body's path and query only when the body names a page on it.
`hostFrom()` checks a candidate the same way for a `handle` that reads
`Referer`. See [`host`](/guides/server/#host).

The browser does not take its location from the markup at all: the
elements load JavaScript, CSS and data from the URL the page loaded
`/index.js` from.

### Trusting any location

`"*"` in `trustedOrigins` (or `DROPLETS_TRUSTED_ORIGINS`) trusts any
location a request's headers name. The server allows it; under `vite dev`
and `vite build` it warns (a production server logs errors only):

```
trustedOrigins: "*" trusts any forwarded location; see https://dropletsjs.dev/guides/security/#trusting-any-location
```

What it opens up:

- **Cache poisoning.** One request with
  `X-Forwarded-Host: evil.example` gets a fragment whose stylesheet, `Link`
  preloads, `droplet.url()` and action URLs point at `evil.example`. Any
  cache in front that keeps it (a CDN ignores `Vary` on these headers)
  serves it to everyone: their forms post to the attacker, their pages load
  the attacker's CSS.
- **CSRF.** The location's origin counts as the server's own in the
  [`Origin` check](#csrf-the-origin-check) and as a redirect target. A page
  on `evil.example` that also sends `X-Forwarded-Host: evil.example` posts
  forms that pass the check.

It may be acceptable when no client can set these headers: a server on a
private network that only your own services reach, or behind a proxy that
strips every one of them and sets them itself, with the droplets server
reachable through nothing else. Even then, prefer listing the exact
origins in `trustedOrigins`. With `"*"`, a header's location is still
checked for a web URL and a clean prefix, nothing more.

## Caching

What each answer sends as `Cache-Control`:

| Answer | `Cache-Control` | Set by |
| --- | --- | --- |
| `/assets/*` (but `public/`), `client.js`, `style.css` | `public, max-age=2592000, immutable` | fixed: files under `/assets/` are content-addressed, and the routes carry the build's hash as `?c=<hash>`, so a deploy invalidates them |
| `/assets/public/*`, the project's `public/` | `no-cache`, with an `ETag` (a `304` while the file is the same) | [`publicCacheControl`](/guides/configuration/#options): another value, or `false` for none; the `ETag` and `304` stay |
| `/index.js`, `/index.css` | `no-store` | fixed |
| `/env.js` | `public, max-age=600` | `DROPLETS_ENV_MAX_AGE` (seconds, `0` for `no-store`) |
| fragments and `_data` | `private, no-store` | the load's [`setHeaders`](/guides/server/#setheaders), else `fragmentCacheControl` (`false` for none); `handle` has the last word |
| a render with a form's result, and the `303` that carries one | `private, no-store` | fixed |

None of the files pass through `handle` (see
[`handle`](/guides/server/#handle)): anything under `/assets/` is public to
whoever has its URL. The import map is not cached by the server.

### How `/index.js` picks up a new build

`/index.js` is a small file of the build that imports the entry client
under a name unique to the build, relative to its own URL:

```js
import "./env.js";
import "./assets/index.C-iXBKI0.js";

((globalThis[Symbol.for("droplets.servers")] ??= {})["my-widgets:a151d9"] ??= {}).origin = new URL(/* @vite-ignore */ ".", import.meta.url).href.replace(/\/$/, "");
```

- **Always fresh, mostly cached.** A page that loads `/index.js` always
  learns about the newest build; on a reload only those few bytes go over
  the network, and the entry comes from the cache.
- **`/env.js` first.** The imports are static, so the browser fetches both
  at once and runs `env.js` first. `import "./env.js"` is there only when
  `src/env.ts` declares runtime public variables (`{ public: true }`
  without `static`): `/env.js` hands the page their current values, takes
  nothing from the request, and a shared cache may keep it. `handle` never
  runs for it.
- **Where the elements load from.** The last line records where the page
  loaded `/index.js` from, prefix included: the elements load from there.
  It runs after the entry; an element that connects before it finds the
  same location from the entry's own URL. `$droplets/drop` reads the
  server's origin from the same record.
- **One record per server and build**, under `<element>:<build>`. Servers
  sharing a page already need distinct `element` names; the build hash
  tells two builds of one server apart.
- **Served by the droplets server.** `/index.js` must come from the
  droplets server, under its prefix: its own URL is what the browser
  trusts. A CDN in front of it, pulling from the server at the same URL,
  works; a copy uploaded elsewhere would make the elements load from there.

### Fragments and `_data`

They depend on the request's `host`, props and cookies, so a shared cache
must not keep them by default. A droplet that is the same for everyone
opens itself to caches with [`setHeaders`](/guides/server/#setheaders) in
its load, which replaces the default on the fragment and on `_data`.

- **Only what rendered.** The default is for `2xx` answers: an error
  answer, a load that failed, a `404`, a `405` and a redirect carry none of
  it (nor the load's), so a `fragmentCacheControl` meant for content never
  keeps a failure.
- **Prerendered renders** are served with the headers their load set at
  build.
- **`Vary`.** Every fragment and `_data` answer carries
  `Vary: x-droplet-location, forwarded, x-forwarded-host, x-forwarded-proto, x-forwarded-port, x-forwarded-prefix, origin`,
  after any `Vary` the load set; with `location` set, `Vary: origin` alone,
  since no location header decides them. These are the headers the
  answer's URLs and `host` come from, so in a cache that honors `Vary` a
  request with a spoofed one lands in an entry of its own. CDNs mostly
  ignore `Vary` on custom headers, though: what keeps a spoofed location
  out of a shared cache is that the server ignores it unless it is on the
  [allow-list](#the-droplet-location-and-host).

Cache fragments in your host page's server if their content allows it.

## CSRF: the `Origin` check

A page on another site can make a browser post a form to your server with
the user's cookies. A `POST`, `PUT`, `PATCH` or `DELETE` to `/droplets/*`
or `/api/*` whose body is form-urlencoded, multipart or `text/plain`, or
that has no content type, answers `403` before `handle` runs unless its
`Origin` is the server's own (or its location's), in `trustedOrigins`, or
[`host`](/guides/configuration/#a-fixed-host) of the config (the import map
paths are checked the same way); `"*"` in `trustedOrigins` lets every
request through:

- a form post without an `Origin`, or with `Origin: null` (a page with
  `Referrer-Policy: no-referrer`), is refused;
- a request without a content type and without an `Origin` passes: that is
  another server calling, not a browser;
- JSON bodies and `GET`s are not checked: a cross-origin JSON post needs a
  CORS preflight, which `cors` answers.

`csrf: { checkOrigin: false }` turns it off. See
[Form posts](/integrate/http-contract/#form-posts-the-origin-check).

A request [`event.fetch`](/guides/server/#eventfetch) sends to this server
is checked the same way: it carries the outer request's `Origin`, so a form
post from a request the check let through passes, and one from a request
without an `Origin` sets `origin` itself or is refused.

## CORS

When the host page and the droplets server are on different origins, the
browser needs permission to load `/index.js` and `/droplets/<id>/client.js`
as modules, to `POST` to `/droplets/<id>/_data` with a JSON body, and to
load fonts. Set `cors` in `droplets.config.ts`: `true`, or an origin list.
Stylesheets and images need no CORS. On Cloudflare the build's files
(`/index.js`, `/assets/*`, `client.js`, `style.css`) are answered by the
static assets with `Access-Control-Allow-Origin: *` from the generated
`_headers`, whatever `cors` says; `cors` covers what the Worker answers.
With CORS on, `Access-Control-Expose-Headers` always includes `Link` and
`x-droplets-build`, on top of any `exposeHeaders` you pass. A host page's
server that proxies the droplets routes under its own origin
([the paths](/integrate/any-stack/#the-paths-to-proxy)) needs no CORS at all.

`cors: true` sends `Access-Control-Allow-Origin: *` on every route, `/api/*`
and `_data` included, and warns once under `vite dev`. For anything that is
not public, list the hosts instead (`cors: { origin: [...] }`): with `*`,
any page can read what an employee's browser can reach on an intranet
server. The same goes for `server.cors` in `vite dev`, which otherwise lets
any site you visit read the dev server's sources. See
[`cors`](/guides/configuration/#options).

## Cookies

- Defaults: `httpOnly: true`, `sameSite: "lax"`, `secure: true` except over
  plain HTTP to `localhost` or a loopback address. `path` is required and
  absolute. `sameSite: "none"` without `secure: true` throws.
- What `handle`, a `+server.ts` handler or an [action](/guides/actions/)
  sets with [`event.cookies`](/guides/server/#cookies) goes out as
  `Set-Cookie` on the response that answers the request: the fragment,
  `_data` or the endpoint, also an error, a redirect or a response the
  handler built itself.
- A droplet's `load` and `transform` only read cookies: `cookies.set()` and
  `cookies.delete()` throw there.
- Using cookies while prerendering throws `CookiesInPrerenderError` and
  stops the build.

Cookies reach the browser in one of two ways:

- **same origin**: the host page's server proxies the droplets routes under its own
  origin ([the paths](/integrate/any-stack/#the-paths-to-proxy)); the
  browser sends and receives them directly, as first-party cookies;
- **forwarded by the host page's server**: a fragment it fetches
  delivers its `Set-Cookie` to that server, not to the browser. That server
  passes it on with its page, and forwards the browser's `Cookie` header
  when it fetches fragments. It never passes on a `Domain` attribute: the
  cookie belongs to the host page's own origin.

A host page's server fetching fragments does not follow redirects
(`fetch(url, { redirect: "manual" })`): a redirect is the droplet's answer,
for that server to pass on, and following it would make it
request a URL someone else chose.

## Limits

Bodies over a limit answer `413` before `handle` runs: 1 MB of JSON, 1 MB of
form-urlencoded or `text/plain`, 10 MB of multipart or anything else. An
`x-droplet-props` header over 8 KB answers `431`. A body without a
`content-length` is held in memory while it is counted, so mind the
multipart limit times your concurrency. `limits` in `droplets.config.ts`
changes them. See [Body limits](/integrate/http-contract/#body-limits).

## Server-only code

- `$droplets/server` and `$droplets/env/private` can only be imported from
  server files: names with `.server.` in them, any extension
  (`+droplet.server.ts`, `hooks.server.ts`, `db.server.tsx`), `+server.*`
  routes and files under a folder named `server/` (`observer.ts` and
  `server-utils/x.ts` are not). Any other project file that imports them
  fails the build.
- Server files never reach the browser. A `*.server.*` file, a `+server.*`
  route or anything under a `server/` folder that client code reaches,
  directly or through other modules, fails `vite build` and is refused by
  `vite dev`, with the import chain. Case does not matter: `Server/`,
  `SERVER/` and `db.Server.ts` count as server files. The same holds for a
  server file named as a file rather than imported as a module:
  `new URL("./keys.server.json", import.meta.url)`, a CSS `url()`, a `?url`,
  `?raw` or `?inline` import fails the build whether Vite would inline it as
  a `data:` URI or emit it, and `vite dev` answers 403 when the browser asks
  for one (`/src/lib/server/keys.txt`). A universal
  `+droplet.ts` runs in the browser and cannot import them. Dependencies in `node_modules` are not
  checked: keep secrets in your own server files.
- Load results are inlined into the page. Never return a private value, a
  token or a password hash from a load.
- Without `handleError` in `+droplet.server.ts`, a production server sends
  a failed load's error page only `Internal Error`; what a driver or a query
  said stays in the log.

See [Environment variables](/guides/server/#environment-variables).

## Form actions without JavaScript

A form posted without JavaScript is answered with a `303` back to its page,
the action's result signed in the page's query
([Post/Redirect/Get](/guides/actions/#without-javascript-postredirectget)).
What that token is, and is not:

- **Signed, not encrypted.** `base64url(JSON { status, data, exp, action })`,
  a `.`, and an HMAC-SHA256 keyed with `DROPLETS_SECRET`. Anyone with the
  URL can read it: it is in history, logs and `Referer`s. Return field
  names and message codes, never the submitted values or secrets.
- **Bound to one droplet, one build and one page.** The MAC covers the
  droplet, the build, the page's origin and path, and the JSON. A result
  minted for one page is ignored on any other.
- **Short-lived and small.** Five minutes, 2 KB; over 2 KB, `data` is
  dropped and `form` is `undefined`.
- **Checked before it is read.** Length and shape, then the MAC
  (`crypto.subtle.verify`), then plain `JSON.parse` into objects without
  prototypes, then the expiry and an action the droplet still exports.
  Anything else is ignored, as if there were none.
- **Display only.** Anyone who can post the form can make a URL that shows a
  result to someone else for five minutes, and a reload shows it again.
  Never decide access from `form`, and do what must happen once in the
  action.
- **Back only to trusted pages.** The page, and any `redirect()` target
  (for an enhanced form's JSON answer too), must be on the server's own
  origin, in `trustedOrigins` or `host` of the config, by exact origin,
  `http:` or `https:` only. `"*"` never counts: it lets every origin
  post, never sends the browser anywhere. A post with no page that passes
  answers `400` before its action runs.
- **One secret per build.** `DROPLETS_SECRET` is set up as in
  [Actions](/guides/actions/#setup-droplets_secret): 32 or more random
  bytes, the same on every instance, kept as a secret.

## Redirects

Every `redirect()` the server answers passes one bound, wherever it was
thrown: a droplet's load or `transform`, `handle`, a form action (its JSON
answer included) or a `+server.ts` handler.

- **Resolved first.** The target becomes an absolute URL: against `host`
  (the page the droplet renders on) for a droplet's code, `handle` and an
  action; against the request's URL on the droplet location for an
  endpoint.
- **Answered only on known origins.** Its exact origin must be the
  server's own, its droplet location's, in `trustedOrigins` (or
  `DROPLETS_TRUSTED_ORIGINS`) or the configured `host`; `http:` or `https:`
  only, without credentials. `"*"` in `trustedOrigins` never counts here.
- **Anything else answers `400`**, with no `location` and one line in the
  server log: an off-site URL, `javascript:`, `//evil.example`.
- **A reported `host` is no way around it.** Without a `trustedOrigins`
  list, `host` stands as an untrusted `Origin` reported it; a relative
  target resolved against it is refused the same way.

## Request input

Droplets follows a few rules for everything a request brings, and your
actions and `+server.ts` handlers should too:

- **Plain data only.** Props arrive as strings from the query, or as JSON
  from a body or `x-droplet-props`, and go through the
  [props schema](/guides/writing-droplets/#a-props-schema) before any load.
  An action reads its own body and checks each field's type; nothing of the
  body is merged into props or anything else. An action returns plain JSON
  (object literals, arrays, strings, finite numbers, booleans, `null`): a
  `Date`, a class instance or a function answers `500`. A signed form
  result is parsed with plain `JSON.parse` and copied into objects without
  prototypes, `__proto__` dropped; props and `form` from a JSON body or
  `x-droplet-props` are copied the same way, as ordinary objects without an
  own `__proto__` key and at most 64 levels deep; enhanced forms read an
  answer with own keys only.
- **Own properties only.** An action name is looked up as an own function of
  a plain `actions` object, and must match `[A-Za-z_][\w-]*`: `__proto__`,
  `constructor` or `toString` answer `404`. Manifest and registry lookups use
  `Object.hasOwn` or a `Map`. In your code, read a request-chosen key with
  `Object.hasOwn` (or a `Map`), never with `obj[key]` on an ordinary object.
- **Code is resolved before the body is parsed.** The `Origin` check and
  the body limits run first; then the droplet, its `actions` export and the
  action's name are resolved; only then does the action read the body. A
  droplet without `actions` answers `405` with its body never read. A
  request never chooses which code runs through anything it sends in a
  body.

Two more places where request data meets HTML:

- `transform` writes into HTML with `host` and props from the request:
  escape what you splice in, and pass the replacement as a function. See
  [`transform`](/guides/prerendering/#transform).
- Build-time renders hold `host` and the location as tokens that carry a
  per-build nonce, so content cannot fake one (none at all when `location`
  and `host` are both set). They are filled with HTML
  escaping: use them in text and attribute positions, not inside an inline
  `<script>` or `<style>`. See [`host` at build](/guides/prerendering/#host-at-build).

## Host-asserted identity

A droplets server with no login of its own can take the visitor's identity
from the host page's server, when that server already has a login. The
[WordPress tutorial](/integrate/wordpress/#4-the-login-is-wordpresss) does
this: a logged-in admin's requests carry a signed assertion, and the
droplets server treats it as the admin. It is safe only under the
conditions in [When this pattern is fine](/integrate/wordpress/#when-this-pattern-is-fine),
all of them: the host page's server the only way in and stripping the
assertion header, a secret per direction, an assertion bound to one
request, unsafe requests checked on both sides, writes back allow-listed.
Where the droplets server is reachable from the internet, or the host page's
server cannot strip headers, use a login of its own instead, as the shop does.

## What the log holds

A production server logs errors only, with `console.error`; the warnings
above (untrusted locations, `"*"`, a missing `DROPLETS_SECRET`, `cors`
allowing every origin) show under `vite dev` and are not in a production
bundle. The list is in [Logging](/guides/deployment/#logging).

## For hosts

A host page's server that fetches fragments follows the five-line
[security checklist](/integrate/any-stack/#security-checklist) on
[Any other stack](/integrate/any-stack/), with the headers it sends and
passes on.

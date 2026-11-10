---
title: Security model
description: "What a droplets server trusts, who sees what, and the rules for x-host, CSRF, cookies, limits, server-only code, signed form results and request input."
---

This page gathers the rules spread over the guides, in one place. Each
section links to where the details live.

## The trust model

A droplet renders inside pages its server does not own, and those pages
call it with whatever they like. Two things follow:

- **The droplets server trusts the host page's operator, not the request.**
  Everything a request carries is input: `host`, `x-host`, the props, the
  form body, the cookies. Render with it; never decide from it who may see
  or do what. That is the job of a session cookie or a token checked in
  `handle` and the actions.
- **The host page trusts the droplets server like a third-party script.**
  The fragment's markup and the bundles run on its page with its origin's
  rights. Embed droplets only from servers you would let run a script on
  that page.

### Who sees what

Embedding a droplet tells its server where it renders: the page's URL,
path and query, in [`host`](/guides/writing-droplets/#host). A host that
fetches fragments on its server sends it (as `"host"` in a `POST` render,
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

## `x-host` and `host`

`x-host` is where the browser reaches the droplets server; it decides the
URLs a fragment writes about itself (its stylesheet, its `Link` preloads,
its action URLs). Anyone can send the header, so:

- it is honoured only when its origin is the request's own or listed in
  `trustedOrigins` / `DROPLETS_TRUSTED_ORIGINS`; `"*"` does not count. An
  untrusted one is ignored with a warning, and never reaches an action URL;
- it must be an `http:` or `https:` URL; credentials, query and hash are
  dropped;
- the proxy or host that sends it **overwrites** it with a fixed value,
  written out in its configuration, never built from the request's `Host`;
  and the droplets server is not reachable around that proxy.

`host` (where the droplet renders) is taken from the request too: a render
body, `Forwarded`, `X-Forwarded-*`, `Origin`. With `trustedOrigins` set, a
`host` outside it (and not this server) becomes the server's own origin.
`hostFrom()` checks a candidate the same way for a `handle` that reads
`Referer`. See [`x-host`](/integrate/http-contract/#x-host-the-public-location)
and [`host`](/guides/writing-droplets/#host).

The browser does not take its location from the markup at all: the
elements load JavaScript, CSS and data from the URL the page loaded
`/index.js` from.

## Caching

Fragments and `_data` are `cache-control: private, no-store` by default:
they depend on the request's host, props and cookies. A droplet that is the
same for everyone opens itself to caches with
[`setHeaders`](/guides/writing-droplets/#setheaders). Every fragment and
`_data` answer carries
`Vary: x-host, forwarded, x-forwarded-host, x-forwarded-proto, origin`, so
a request with a spoofed header lands in a cache entry of its own and
cannot poison the one everybody else gets. A rendered form result is
always `private, no-store`. See [Caching](/integrate/http-contract/#caching).

## CSRF: the `Origin` check

A page on another site can make a browser post a form to your server with
the user's cookies. A `POST`, `PUT`, `PATCH` or `DELETE` to `/droplets/*`
or `/api/*` whose body is form-urlencoded, multipart or `text/plain`, or
that has no content type, answers `403` before `handle` runs unless its
`Origin` is the server's own (or a trusted `x-host`'s) or in
`trustedOrigins`:

- a form post without an `Origin`, or with `Origin: null` (a page with
  `Referrer-Policy: no-referrer`), is refused;
- a request without a content type and without an `Origin` passes: that is
  another server calling, not a browser;
- JSON bodies and `GET`s are not checked: a cross-origin JSON post needs a
  CORS preflight, which `cors` answers.

`csrf: { checkOrigin: false }` turns it off. See
[Form posts](/integrate/http-contract/#form-posts-the-origin-check).

## CORS

`cors: true` sends `Access-Control-Allow-Origin: *` on every route, `/api/*`
and `_data` included, and warns once in production. For anything that is
not public, list the hosts instead (`cors: { origin: [...] }`): with `*`,
any page can read what an employee's browser can reach on an intranet
server. The same goes for `server.cors` in `vite dev`, which otherwise lets
any site you visit read the dev server's sources. See
[`cors`](/guides/configuration/#options).

## Cookies

- Defaults: `httpOnly: true`, `sameSite: "lax"`, `secure: true` except over
  plain HTTP to `localhost` or a loopback address. `path` is required and
  absolute. `sameSite: "none"` without `secure: true` throws.
- A droplet's `load` and `transform` read cookies only; `set` and `delete`
  throw there. `handle`, `+server.ts` and [actions](/guides/writing-droplets/#actions)
  set them.
- A fragment the host's server fetches hands its `Set-Cookie` to that
  server. The host passes it on with its page, forwards the browser's
  `Cookie` when it fetches fragments, and never passes on a `Domain`: the
  cookie belongs to the host's own origin. Proxying the droplets routes
  under the host's origin makes them first-party.
- Using cookies while prerendering throws `CookiesInPrerenderError` and
  stops the build.

See [Cookies](/guides/server/#cookies).

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
  `vite dev`, with the import chain. A universal `+droplet.ts` runs in the
  browser and cannot import them. Dependencies in `node_modules` are not
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
([Post/Redirect/Get](/guides/writing-droplets/#without-javascript-postredirectget)).
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
- **Back only to trusted pages.** The page, and any `redirect()` target,
  must be on the server's own origin or in `trustedOrigins`, by exact
  origin, `http:` or `https:` only. `"*"` never counts: it lets every origin
  post, never sends the browser anywhere. A post with no page that passes
  answers `400` before its action runs.

`DROPLETS_SECRET` is 32 or more random bytes (`openssl rand -base64 32`),
read at runtime, the same on every instance serving a build, kept as a
secret. Rotating it voids the results of the last five minutes and nothing
else. Without it, such a post answers the fragment rendered with `form`.

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
  prototypes, `__proto__` dropped; enhanced forms read an answer with own
  keys only.
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
  [`transform`](/guides/writing-droplets/#transform).
- Build-time renders hold `host` and the location as tokens that carry a
  per-build nonce, so content cannot fake one. They are filled with HTML
  escaping: use them in text and attribute positions, not inside an inline
  `<script>` or `<style>`. See [`host` at build](/guides/writing-droplets/#host-at-build).

## Host-asserted identity

A droplets server with no login of its own can take the visitor's identity
from the host, when the host already has a login and the droplets server is
reachable only through it. [The WordPress host](/integrate/wordpress/#4-the-login-is-wordpresss) does this with
WordPress: a logged-in admin's requests carry a signed assertion, and the
droplets server treats it as the admin.

It is fine when all of these hold:

- **The host is the only way in.** The droplets server is on a private
  network, its port not published; the browser reaches it through the
  host's server, which fetches the fragments and proxies the rest.
- **The host strips the header.** It forwards a short list of request
  headers, never the assertion's; a browser that sends one has it dropped.
  The host's own login cookies are not forwarded either.
- **A secret shared by the two servers only** signs it, 32 bytes or more,
  from the environment on both sides. Without it, or with a short one,
  nobody is an admin. **One secret per direction**: the writes back (below)
  have their own, and both sides refuse the two when they are equal, so a
  key that leaks signs one direction only.
- **It is bound to one request.** The claims name the user, the role, an
  expiry at most a minute out, the method, the path and query on the
  droplets server, and the audience (`aud`). A captured assertion is
  worth one URL, for a minute; one signed for another server is refused.
- **The host checks unsafe requests too.** It signs a form post only when
  the browser's `Origin` is its own, and the droplets server's
  [`Origin` check](#csrf-the-origin-check) runs as for every form post.

The droplets server reads it as untrusted input, in this order: a size cap
on the header; the MAC with `crypto.subtle.verify`, before anything is
decoded; a plain `JSON.parse`; own keys (`Object.hasOwn`) copied into an
object without a prototype, each checked for its type; then the expiry, the
method, the path and the audience. Any failure is no identity, never an
error that says which check failed. A page rendered for an asserted user is
`private, no-store`.

Writes back to the host go the same way, the other direction, with the
other secret: the droplets server signs for `aud` of the host, and the host
maps the claims to its own user, who must still have the right to do it.
**Only for the writes the droplets server makes**: the host keeps an
allow-list of method and route, anchored, ids numeric, and ignores the
assertion everywhere else, so whoever holds that secret can do those
writes and nothing more (not the host's users, settings or plugins).
wp-shop's is one route, `POST /wp-json/wp/v2/products/<id>`. Neither side
holds the other's passwords.

Where the droplets server is reachable from the internet, or the host
cannot strip headers, use a login of its own instead, as the shop does.

## For hosts

A host that fetches fragments on its server:

- sends a fixed `x-host`, written out, and lists it in the droplets
  server's `DROPLETS_TRUSTED_ORIGINS`;
- does not follow redirects (`fetch(url, { redirect: "manual" })`): a
  redirect is the droplet's answer to pass on, and following it would make
  the host's server request a URL someone else chose;
- pastes only `text/html` answers (a `200`, or a `500` with the error page):
  a `400` or `404` is plain text that may echo the props;
- forwards the browser's `Cookie`, and passes `Set-Cookie` on without a
  `Domain`;
- keeps `Referrer-Policy` at the default
  `strict-origin-when-cross-origin` on pages with forms, or forms cannot
  post.

[Known hosts](/integrate/hosts/overview/) and the
[HTTP contract](/integrate/http-contract/) have the rest.

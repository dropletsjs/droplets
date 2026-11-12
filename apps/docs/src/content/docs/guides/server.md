---
title: Server code
description: "hooks.server.ts, API routes, environment variables and import maps."
---

Server code in Droplets follows SvelteKit's conventions. It never sees Hono:
everything is a web-standard `Request` in and `Response` out, so the same code
runs on Node and on Workers.

## `src/hooks.server.ts`

Runs on the server, per request. Its browser counterpart,
[`src/hooks.client.ts`](/guides/in-the-browser/#srchooksclientts), runs once
per page before any droplet starts.

### `handle`

Runs for every request except the health check and the files: fill
`event.locals`, answer early without calling `resolve`, or change the
response. A `redirect()` thrown here is resolved against `event.host` and
answered only on the server's own origin, its location's, a
`trustedOrigins` entry or `host` of the config, the bound every redirect a
droplet answers passes ([Security](/guides/security/#redirects)); any
other target answers `400`.

`/index.js`, `/index.css`, `/env.js` and every path under `/assets/` (the bundles' chunks,
stylesheets, imported files and `public/` at `/assets/public/`) are answered
without calling `handle`, on every adapter and in `vite dev`, as SvelteKit
serves its static files. Fragments, `_data`, actions and `/api/*` all run
through it. `/droplets/<id>/client.js` and `style.css` do on Node, Bun and
Deno; on Cloudflare they are files of the build that the static assets
answer before the Worker runs. So `handle` cannot guard a file: everything
under `/assets/` is public to whoever has its URL. A file
only some users may see belongs behind an endpoint that checks who asks, in
`src/api/`, or on a storage service that hands out signed URLs, and the
droplet links to that.

```ts
// src/hooks.server.ts
import type { Handle } from "$droplets/server";

declare module "@dropletsjs/droplets/server" {
  interface Locals {
    requestId: string;
    user: { id: string } | null;
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.requestId = crypto.randomUUID().slice(0, 8);
  event.locals.user = await readSession(event.cookies.get("session"));

  const response = await resolve(event);
  response.headers.set("x-request-id", event.locals.requestId);
  return response;
};
```

Whatever lands in `event.locals` reaches droplet server loads and `+server.ts`
handlers. `locals` are never serialized into a fragment. `sequence(a, b, c)`
from `$droplets/server` chains several `handle` functions.

The event:

```ts
type RequestEvent = {
  request: Request;
  url: URL;                       // the request's path and query under the public location, prefix included
  host: URL;                      // where the droplet renders: the host page; handle may replace it
  params: Record<string, string>; // API route parameters
  locals: Locals;
  platform: { env?: unknown; context?: unknown };
  cookies: Cookies;               // see Cookies below
  fetch: typeof fetch;            // see event.fetch below
};
```

On Workers `platform.env` holds the bindings (KV, D1, R2…) and
`platform.context` the execution context.

### `handleError`

The last stop for unexpected errors leaving the server: `handle`,
`+server.ts`, the import map, a droplet that cannot show its error page. Log
the error and choose the message the answer carries; returning nothing keeps
"Internal Server Error".

```ts
import type { HandleServerError } from "$droplets/server";

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  report(error, event.url);
  return { message: "Something broke; we are on it." };
};
```

Errors inside a droplet's loads go to the droplet's own `handleError` first;
see [Errors](/guides/errors/).

## Cookies

`event.cookies` works as in SvelteKit, on the event of `handle` and
`+server.ts` handlers. A droplet's server load and `transform` get cookies to
read only (`get` and `getAll`, the `ReadonlyCookies` type): a droplet renders
as a host asked for it, and what it set would reach the browser only if that
host passed it on. `cookies.set()` and `cookies.delete()` throw there; set
cookies in `handle` or `+server.ts`.

```ts
// src/api/login/+server.ts
import { timingSafeEqual } from "node:crypto";
import { error, json, type RequestHandler } from "$droplets/server";
import { ADMIN_PASSWORD } from "$droplets/env/private";

const same = (a: string, b: string) => {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
};

export const POST: RequestHandler = async ({ request, cookies }) => {
  const form = await request.formData();
  if (!same(String(form.get("password") ?? ""), ADMIN_PASSWORD)) error(401, "Wrong password");
  cookies.set("session", await sign("admin"), { path: "/", maxAge: 60 * 60 * 8 });
  return json({ ok: true });
};
```

Compare secrets in constant time (`timingSafeEqual` on Node, Bun and Deno;
`crypto.subtle.timingSafeEqual` on Workers), and store a hash, not the
password, in anything real.

| Method | Does |
| --- | --- |
| `get(name, { decode? })` | The value, or `undefined`. Sees what this request set or deleted. |
| `getAll({ decode? })` | `[{ name, value }]`, the request's and this request's own. |
| `set(name, value, options)` | Records a `Set-Cookie` for the response. |
| `delete(name, options)` | Expires it (`Max-Age=0`); `path` and `domain` must match the ones it was set with. |
| `serialize(name, value, options)` | The `Set-Cookie` value, for a response you build yourself. |

`options.path` is required, and absolute (`"/"`, `"/admin"`): the response
may reach the browser through a host, under the host's URLs. Defaults:
`httpOnly: true`, `sameSite: "lax"`, and `secure: true` except over plain
HTTP to `localhost` or a loopback address (the dev server), judged by the
server's public [location](/integrate/http-contract/#x-droplet-location-the-public-location).
`sameSite: "none"` without `secure: true` throws: browsers drop such a
cookie. Values are `encodeURIComponent`ed unless you pass `encode`. Setting
the same name, domain and path twice sends the last one.

Whatever answers the request carries the cookies: the fragment, `_data`,
the endpoint's response (even one with immutable headers, such as
`Response.redirect()`), an `error()` or `redirect()`, or a response `handle`
returns without resolving. A fragment the host's server fetches hands its
`Set-Cookie` to that server; see
[Cookies](/guides/security/#cookies) in the Security model for how cookies
reach the browser (same origin, or a host that forwards them, never their
`Domain`).

Cookies do not exist at build: using them while prerendering throws
`CookiesInPrerenderError` and stops the build, as reading
[`host`](/guides/prerendering/#host-at-build) beyond its tokens does.
`handle` runs for build-time renders too, so skip cookies there when
`building` from `$droplets/env` is true.

## `event.fetch`

Every server event (`handle`, `+server.ts` handlers, a droplet's server
`load`, `transform` and form actions) carries `fetch`, as SvelteKit's
does. A URL on this server is answered in-process, with no network hop;
any other URL goes to the global `fetch`. `entries` runs before any
request and has no event.

```ts
// src/droplets/testimonials/+droplet.server.ts
import type { LoadEvent } from "./$types";

export const load = async ({ fetch }: LoadEvent) => {
  const res = await fetch("/api/testimonials?max=10&random=true");
  return { testimonials: await res.json() };
};
```

A URL is this server's when it is relative (resolved against
`request.url`, the request as the server received it, so `/api/x` is the
route `/api/x` whatever prefix a proxy adds), absolute on the request's own
origin, or absolute under the droplet
[location](/integrate/http-contract/#x-droplet-location-the-public-location),
prefix included: with the server at `https://shop.example/mfe`,
`https://shop.example/mfe/api/x` is `/api/x`, while
`https://shop.example/other` is another site and goes to the network. Such
a request is dispatched into the app as a request of its own, exactly as
one from outside: the location is resolved again, the `Origin` check and
the body limits apply, `handle` runs (with `locals` of its own), the route
is matched, and a path no route matches answers `404` from the app, never
from the network. `/api/*`, the `/droplets/*` routes and the files the app
serves all answer this way. Being internal grants nothing: a location
header on it is trusted only against `trustedOrigins`, a `redirect()` it
answers passes the same bound, a form token is checked the same way.

What it carries from the request it runs for, each unless `init` sets the
header itself:

- `cookie` and `authorization`, except with `credentials: "omit"`;
- the location and host headers, `x-droplet-location`, `Forwarded`,
  `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Port`,
  `X-Forwarded-Prefix` and `Origin`, so the internal request resolves the
  same location and `host` (and a form post passes the `Origin` check when
  the outer request did; one made from a request without an `Origin` sets
  `headers: { origin: event.url.origin }`).

Nothing else of the incoming request: not its body, not any other header.
A request to another origin gets only what `init` says, never the
incoming cookies or `authorization`, nor any header you did not set.

A `Set-Cookie` an internal answer carries stays on that `Response`
(`response.headers.getSetCookie()`); it does not reach the outer response,
for the reason a load cannot set cookies: a droplet's answer may be
fetched by a host's server. Set it yourself where cookies can be set.

A request that fetches itself, directly or through other routes, stops at
four nested internal requests: the fifth throws an `Error` naming the URL,
which the outermost request answers as `500` through
[`handleError`](#handleerror). Call the code a route runs rather than
the route when the two are in the same server.

While prerendering there is no incoming request: an internal request
carries no cookies, and an endpoint that reads `cookies` answers the
build's `500` (`CookiesInPrerenderError` in its body) rather than stopping
the build; `handle` runs for it as for any build-time render. A fetch to
another origin at build goes to the network and its result is stored with
the render. `vite dev` behaves exactly as a built server does.

## API routes

`+server.ts` files under `src/api` (the `apiFolder` option) answer under
`/api/`:

```
src/api/
  health-report/+server.ts      → /api/health-report
  greet/[name]/+server.ts       → /api/greet/Ana
  files/[...path]/+server.ts    → /api/files/a/b/c
  (admin)/users/+server.ts      → /api/users        (a group: not in the URL)
```

```ts
// src/api/greet/[name]/+server.ts
import { error, json, type RequestHandler } from "$droplets/server";

export const GET: RequestHandler<{ name: string }> = ({ params, locals }) => {
  if (params.name.length > 40) error(400, "That name is too long.");
  return json({ greeting: `Hello ${params.name}!`, requestId: locals.requestId });
};
```

Export one function per method (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`,
`OPTIONS`, `HEAD`), or `fallback` for every method the module does not
export, a non-standard one included, as in SvelteKit. `HEAD` without its
own export runs `GET` and drops the body. A method with neither its own
export nor `fallback` answers `405` with `Allow` listing the exported
methods (omitted when there is none). An export of any other name
(`CONFIG`, say) is never called as a method. A path no route matches
answers `404` `{ "message": "Not Found" }`, and a handler that returns no
`Response` a `500`.

A folder in brackets is a parameter (`[name]`) or the rest of the path
(`[...path]`), and one in parentheses (`(admin)`) adds nothing to the URL.
A parameter's value is the path segment percent-decoded, `%2F` included:
`/api/greet/a%2Fb` gives `params.name === "a/b"`, one segment still, and
`[...path]` joins its decoded segments with `/`. Treat a parameter as the
input it is: check its length and shape before it names anything.
Any other bracket form (`[[optional]]`, matchers), a repeated parameter
name, a segment after `[...rest]`, or two routes of the same shape
(`a/[id]` and `a/[slug]`) fail `vite dev` and `vite build`. Routes are
matched most specific first. `+server.ts` and `+server.js` are the only
names read.

`$droplets/server` provides `json()`, `text()`, `error()`, `redirect()`,
`sequence()` and the event types. A `redirect()` from a handler is resolved
against `event.url`, the request's URL on the location, and answered only
on the server's own origin, its location's, a `trustedOrigins` entry or
`host` of the config, else `400` `{ "message": "Bad Request: the endpoint redirects off this site" }`
([Security](/guides/security/#redirects)).

## Environment variables

Declare every variable once, in `src/env.ts`:

```ts
// src/env.ts
import { defineEnvVars } from "@dropletsjs/droplets/env";

export const variables = defineEnvVars({
  API_TOKEN: {},                                      // private, read at runtime
  FEATURE_X: { static: true },                        // private, inlined at build
  PUBLIC_BANNER: { public: true },                    // reaches the browser, read at runtime
  PUBLIC_SITE_NAME: { public: true, static: true },   // reaches the browser, inlined at build
});

declare module "@dropletsjs/droplets/env" {
  interface Register {
    variables: typeof variables;
  }
}
```

Then read them, typed:

```ts
import { env } from "$droplets/env/private"; // server code only
import { env } from "$droplets/env/public";  // anywhere
```

Like SvelteKit, a variable is private and dynamic unless it says otherwise:

| Declaration | Reaches | Value from |
| --- | --- | --- |
| `{}` | the server | its environment, per request |
| `{ static: true }` | the server | the build, inlined |
| `{ public: true }` | server and browser | the server's environment at runtime |
| `{ public: true, static: true }` | server and browser | the build, inlined into every bundle |

- Runtime values come from `.env` files in dev and while prerendering, the
  process environment on Node, Bun and Deno, and the bindings on Workers
  (`.env` files are a build input only there).
- A static variable without a value fails `vite build`, and only warns under
  `vite dev`.
- A dynamic public variable changes with a restart, not a rebuild. The server
  answers `/env.js` with the current values, keyed by element name and build,
  and `/index.js` imports it before the entry, so the browser has them before
  `init()` runs and any droplet mounts; they never appear in a droplet bundle.
  `/env.js` is sent with `cache-control: public, max-age=600`: a page picks up
  a new value within ten minutes. `DROPLETS_ENV_MAX_AGE` sets the seconds
  (read at runtime, `0` sends `no-store`); an invalid value keeps `600`, with
  a warning under `vite dev`. Only `{ public: true }` variables without
  `static` are in it, and the route reads nothing from the request. Without
  such a variable, `/env.js` answers `404` and `/index.js` does not import it.
- `$droplets/env/private` and `$droplets/server` can only be imported from
  server files (`*.server.*` names, `+server.*` routes, files under a `server/` folder).
- Server files themselves never reach the browser: a `*.server.*` file
  (`db.server.ts`, `+droplet.server.ts`), a `+server.*` route or anything
  under a `server/` folder (`src/lib/server/db.ts`) that client code reaches,
  directly or through other modules, fails the build and is refused by the
  dev server, with the import chain in the message. Case does not matter:
  `src/lib/Server/db.ts` and `db.SERVER.ts` are server files too, and so is
  one reached as a file (`new URL(…, import.meta.url)`, a CSS `url()`, a
  `?url` or `?raw` import): inlined or emitted, it fails the build, and the
  dev server answers 403 when the browser fetches it. Keep connection strings
  and keys in those files and read them from `+droplet.server.ts`; a
  universal `+droplet.ts` runs in the browser and cannot import them.
- Never return a private value from a load: load results are inlined into
  the page. See [Server-only code](/guides/security/#server-only-code).

## Import maps

A large library several droplets use (a grid, a chart engine) can stay out of
every droplet bundle and load once from an import map instead. Declare it
external the Vite way:

```ts
// vite.config.ts
export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [svelte()] })],
  environments: {
    client: { build: { rolldownOptions: { external: ["ag-grid-community"] } } },
  },
});
```

and map it per request in `src/importmap.server.ts`:

```ts
// src/importmap.server.ts
import type { ImportMapHandler } from "$droplets/server";

export const importmap: ImportMapHandler = ({ externals }) => ({
  imports: {
    "ag-grid-community": "https://cdn.jsdelivr.net/npm/ag-grid-community@35.0.1/+esm",
  },
});
```

The server answers it at `/importmap` (the `importMap` option) as a
`<script type="importmap">` block, and at `/importmap.js` as a classic script
that inserts that block. A host includes one of them **before** `/index.js`;
the script must be a plain one (no `type="module"`, `defer` or `async`), so it
runs before any module.
Both are on only when the client build has externals, and answer `404`
without the file. The plugin applies the same externals in dev, where the map
gets Vite's `/@id/` spellings, and warns (`warnImportMap`) about externals it
does not map, keys that are not external, and versions that differ from the
installed package.

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

Runs for every request except the health check: fill `event.locals`, answer
early without calling `resolve`, or change the response.

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
  url: URL;                       // on the public origin when a proxy sent x-host
  host: URL;                      // where the droplet renders: the host page; handle may replace it
  params: Record<string, string>; // API route parameters
  locals: Locals;
  platform: { env?: unknown; context?: unknown };
  cookies: Cookies;               // see Cookies below
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
server's public location (`x-host`, else the request). `sameSite: "none"`
without `secure: true` throws: browsers drop such a cookie. Values are
`encodeURIComponent`ed unless you pass `encode`. Setting the same name,
domain and path twice sends the last one.

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
`OPTIONS`), or `fallback` for the rest. A missing method answers `405` with
`Allow`; `HEAD` is derived from `GET`.

`$droplets/server` provides `json()`, `text()`, `error()`, `redirect()`,
`sequence()` and the event types.

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

- Runtime values come from `.env` files in dev, the process environment on
  Node and the bindings on Workers.
- A static variable without a value fails the build.
- A dynamic public variable changes with a restart, not a rebuild. The server
  puts the current values at the top of `/index.js`, keyed by element name and build, so the browser
  has them before any droplet mounts; they never appear in a droplet bundle.
  `/index.js` is never cached, so a page always gets the server's current
  values.
- `$droplets/env/private` and `$droplets/server` can only be imported from
  server files (`*.server.*` names, `+server.*` routes, files under a `server/` folder).
- Server files themselves never reach the browser: a `*.server.*` file
  (`db.server.ts`, `+droplet.server.ts`), a `+server.*` route or anything
  under a `server/` folder (`src/lib/server/db.ts`) that client code reaches,
  directly or through other modules, fails the build and is refused by the
  dev server, with the import chain in the message. Keep connection strings
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

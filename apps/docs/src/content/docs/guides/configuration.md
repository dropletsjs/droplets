---
title: Configuration
description: "Every option in droplets.config.ts, the plugin options and the environment variables."
---

## `droplets.config.ts`

Lives in the project root; `.mts`, `.js` and `.mjs` work too, looked up in
that order (the plugin's `configFile` names another). It holds data only;
request handling lives in [`src/hooks.server.ts`](/guides/server/). Vite
loads it, so TypeScript and imports work, and a default export that is a
function (async or not) is called with Vite's `{ command, mode, isSsrBuild,
isPreview }`. The plugin bundles the file into the server build, where a
function is called again with the same `{ command, mode, … }` the build had
(as a literal in the bundle) and awaited, so the production server sees the
config the build saw, functions inside it included (a `cors.origin`
callback, say); the result is validated again at startup. The `config()`
helper only adds types. An invalid value fails `vite dev` and `vite build`
with a message naming the option; a key the framework does not know is
ignored.

```ts
import { config } from "@dropletsjs/droplets";

export default config({
  dropletsFolder: "src/droplets",   // the default
  apiFolder: "src/api",             // the default

  // The custom element hosting every droplet. Name it after the project so
  // several droplets servers can share a page. Default: "djs-droplet".
  element: "acme-widgets",

  // Pages on other origins embed these droplets: let their browsers in.
  cors: true,                       // or Hono cors() options: { origin: [...] }

  // Where browsers reach this server, fixed at build: see "The droplet location" below.
  location: "https://shop.example/mfe",
  // The page every droplet renders on, fixed at build: see "A fixed host" below.
  host: "https://shop.example",
  // Host pages' origins that post forms to these droplets: see "Trusted origins" below.
  trustedOrigins: ["https://shop.example"],
  csrf: { checkOrigin: true },      // the default
  limits: { multipart: 20 * 1024 * 1024 }, // bytes; the others keep their defaults

  // Fragments and _data: "private, no-store" by default; false sends none.
  fragmentCacheControl: "private, no-store",
  // public/ at /assets/public/*: "no-cache" (revalidated, ETag) by default; false sends none.
  publicCacheControl: "no-cache",

  health: "/health",                // false: no health check
  index: "public/index.html",       // what / serves in production; false: 404
  importMap: "/importmap",          // false: never served

  dev: {
    server: { port: 5173 },         // Vite's own server.port wins if set
    strategy: "hmr",                // "remount" | "reload" | "manual"
    injectTool: false,              // the dev tool on every page
  },
  server: { port: 8000 },           // for node or bun dist/server.js
});
```

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `dropletsFolder` | `"src/droplets"` | Folder scanned for `<name>/+droplet.<ext>`, inside the project: a path with a `..` above it fails. |
| `apiFolder` | `"src/api"` | Folder scanned for `**/+server.ts`, served under `/api/`; inside the project, as `dropletsFolder`. |
| `element` | `"djs-droplet"` | Tag name of the element that hosts every droplet. Lowercase with a hyphen. See [The element name](#the-element-name). |
| `cors` | off | `true` sends `Access-Control-Allow-Origin: *` on every route (`/api/*`, `_data`, `/index.js` included), and warns once under `vite dev`; an object is passed to Hono's `cors()`. Needed whenever a page on another origin embeds your droplets. Prefer an origin list (`{ origin: ["https://shop.example"] }`) for anything not public: with `*`, any page can read what an employee's browser can reach on an intranet server. |
| `location` | computed per request | Where browsers reach this server, fixed at build: its public origin, with the path prefix a proxy serves it under (`"https://shop.example/mfe"`). One value, no query, hash or credentials, never `"*"`. See [The droplet location](#the-droplet-location). |
| `host` | computed per request | The origin of the page every droplet renders on, fixed at build (`"https://shop.example"`, no path, never `"*"`). Prerendering renders an entry without its own `host` there. See [A fixed host](#a-fixed-host). |
| `trustedOrigins` | `[]` | Origins, besides this server's own, that you trust: their pages may post forms and receive redirects, and a location header may name them. `"*"` trusts any origin to post. `DROPLETS_TRUSTED_ORIGINS` adds more at runtime. See [Trusted origins](#trusted-origins). |
| `csrf.checkOrigin` | `true` | Answer `403` to a cross-site form submission (form-urlencoded, multipart or `text/plain` body, or none at all with an `Origin`) to `/droplets/*` or `/api/*` from an origin that is not trusted. `false` turns the check off. |
| `fragmentCacheControl` | `"private, no-store"` | The default `Cache-Control` of fragments and `_data`, when neither the droplet's load ([`setHeaders`](/guides/server/#setheaders)) nor `handle` set one. `false` sends none. See [Caching](/guides/security/#caching). |
| `publicCacheControl` | `"no-cache"` | The `Cache-Control` of `public/`, served at `/assets/public/*` in a build, on every adapter. Its files keep their names, so by default the browser revalidates them each time (an `ETag`, `304`). A string replaces it (`"public, max-age=3600"`), `false` sends none; the `ETag` and `304` stay. Hashed files, `/index.js` and `/env.js` keep their own. See [Caching](/guides/security/#caching). |
| `limits.json` | 1 MB | Largest JSON body, in bytes: render requests and `+server.ts`. Bigger answers `413`. |
| `limits.form` | 1 MB | Largest form-urlencoded or `text/plain` body. |
| `limits.multipart` | 10 MB | Largest multipart body, and body of any other type (uploads). A body without a `content-length` is held in memory while it is counted, up to the limit, so mind it times your concurrency. |
| `limits.props` | 8 KB | Largest `x-droplet-props` header; bigger answers `431`. `Infinity` lifts any limit. |
| `health` | `"/health"` | Path answering `ok`, before `handle` runs, so an auth hook cannot break it. `false` turns it off. |
| `index` | `index.html` in the root, else a placeholder | What `/` serves in `vite preview` and production: an HTML file, served as written. A path that does not exist fails `vite build`. `false` answers `404`. In `vite dev`, `/` belongs to the [devtools](/guides/development/#the-devtools-page). |
| `importMap` | `"/importmap"`, when the client build has externals | Where the [import map](/guides/server/#import-maps) is served; `<path>.js` answers the inserting script. `false` turns both off. |
| `warnImportMap` | `true` | In dev, warn about externals the map misses, keys that are not external, and version drift. |
| `dev.server.port` | `5173` | Dev port, unless `vite.config.ts` sets `server.port`. |
| `dev.strategy` | `"hmr"` | What a droplet on a page does when its files change. `"hmr"` is the framework's own HMR, with new data for a load edit and a notice for a new render contract. `"remount"` loads the droplet again, `"reload"` reloads the page, and `"manual"` does nothing. See [Hot updates](/guides/development/#hot-updates). |
| `dev.injectTool` | `false` | Show the [dev tool](/guides/development/#the-dev-tool) on every page that loads `index.js`. |
| `server.port` | `8000` | Port for `node dist/server.js` and `bun dist/server.js`. `deno serve` takes `--port` instead. |

`health` and `importMap` must be paths the framework does not own: outside
`/`, `/index.js`, `/env.js`, `/index.css`, `/droplets/`, `/assets/` and `/api/`.

### Trusted origins

`trustedOrigins` lists the origins of the host pages you trust, besides
this server's own (`DROPLETS_TRUSTED_ORIGINS`, comma-separated and read at
runtime on every adapter, adds to it). An origin in the list:

- **may post forms** to `/droplets/*` and `/api/*`: the
  [`Origin` check](/integrate/http-contract/#form-posts-the-origin-check)
  lets its pages through;
- **may receive redirects**: an action, a load, `handle` or a `+server.ts`
  handler may [redirect](/guides/security/#redirects) there, and a form
  posted without JavaScript may be
  [sent back](/guides/actions/#without-javascript-postredirectget) to a
  page on it;
- **may name the droplet location**: a location header naming it is
  trusted ([below](#the-droplet-location));
- **bounds `host`**: with a list, a reported host page on another origin
  (and not this server) becomes the droplet location's origin, and
  [`hostFrom()`](/guides/server/#taking-the-page-from-referer) accepts only
  these origins or this server.

`"*"` trusts every origin to post and any location header to name the
droplet location; it never counts as a redirect target, and it bounds no
`host`. It warns under `vite dev` and `vite build`; read
[Trusting any location](/guides/security/#trusting-any-location) first.

```ts
export default config({ trustedOrigins: ["https://shop.example", "https://www.shop.example"] });
```

### The droplet location

The URLs a fragment writes about the server (its stylesheet, `Link`
preloads, action URLs, `droplet.origin`) are on its droplet location: where
the browser reaches `/index.js`. Behind a proxy that is not the address the
request arrived at, so the server reads it from the request, in this order
([details](/integrate/http-contract/#where-it-comes-from)):
`x-droplet-location`, then `Forwarded`, then `X-Forwarded-Proto` with
`X-Forwarded-Host` (both with `X-Forwarded-Prefix` for a path). A header's
location counts only when its origin is the request's own or listed in
`trustedOrigins`; with no header that counts, the location is the request's
own origin.

```ts
// The proxy sends x-droplet-location: https://shop.example/mfe
export default config({ trustedOrigins: ["https://shop.example"] });
```

```bash
# Or at runtime, several of them: the proxy's forwarded headers pick one.
DROPLETS_TRUSTED_ORIGINS=https://shop.example,https://www.shop.example node dist/server.js
```

`"*"` trusts any location a header names, and warns once at start under
`vite dev`; read
[Trusting any location](/guides/security/#trusting-any-location) first.

#### A fixed location

When the server has one public URL, write it as `location`:

```ts
export default config({ location: "https://shop.example/mfe" });
```

`vite build` writes it into the server bundle: imported files,
`new URL("./x", import.meta.url)`, `droplet.url()` and `droplet.origin` at a
module's top level, and every prerendered render. The browser bundles are
the same build either way: they find the location from the URL `/index.js`
was loaded from.

At runtime every request's location is `location`. No location header is
read or trusted, so a proxy that serves the build under another origin or
prefix is ignored: one build serves one location. The `x-droplet-location`
setup above applies only without `location`. Fragments and `_data` then
vary on `origin` alone.

`vite dev` ignores `location` and computes it per request. `vite preview`
and `wrangler dev` serve the build, so the URLs the server writes point at
`location`: a page under them loads its files from there.

### A fixed host

`host` names the origin of the page your droplets render on, when there is
one:

```ts
export default config({ host: "https://shop.example" });
```

At runtime `event.host` is that origin, with the path and query of the page
the request reports (a render body's `host`) when that page is on it; for a
page on another origin, or none, it is the origin alone. `Origin` is not
read. A form posted from that origin passes the
[origin check](/integrate/http-contract/#form-posts-the-origin-check), and
an action may redirect there, as if it were in `trustedOrigins`; a location
header naming it is not trusted for that.

Prerendering renders every entry without its own `host` for it, and stores
it for every page of that origin; see
[`host` at build](/guides/prerendering/#host-at-build).

A form posted without JavaScript from such a render returns to the page the
render was made for, not the visitor's: the path is filled in per request,
the query is not. Either don't prerender that droplet, or name the page in
the entry (`{ props, host: "https://shop.example/docs" }`).
[`enhanceDropletForm`](/guides/actions/) is unaffected: it never leaves the
page.

`vite dev` ignores `host` and takes it from each request.

### Both fixed

With `location` and `host` both set, a build holds no token at all: the
server bundle writes the real values, prerendering stores renders as they
will be served, and no answer is rewritten on its way out. The code that
replaces tokens is not in the server bundle. A render for `host` then knows
no page: `host.pathname` is `/`, and a form posted without JavaScript from
it returns to `host`'s root page. With `location` alone, `host` and the page
are still tokens, replaced per request.

### The element name

Every droplet renders inside a custom element, and `/index.js` defines it.
With the default name, two droplets servers on one page would both try to
define `<djs-droplet>`: the second one loses, and its droplets stay inert.
Give each server its own:

```ts
element: "acme-widgets",
```

The name must be a valid custom element name: lowercase, starting with a
letter, containing a hyphen. It appears in fragments
(`<acme-widgets data-droplet="hello" …>`), in `/index.js` and as the prefix of
every scoped style rule. Hosts that write the element themselves need to
know it.

## Plugin options

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { dropletsDevtools } from "@dropletsjs/devtools";
import { node } from "@dropletsjs/adapter-node";

export default defineConfig({
  plugins: [
    droplets({
      configFile: "droplets.config.ts", // default: looked up in the Vite root
      adapter: node(),                  // required for vite build and preview
      renderers: [svelte()],            // the UI engines; see Renderers
      css: { tailwind: true },          // stylesheets; see below
    }),
    dropletsDevtools(),                 // vite dev only
  ],
});
```

- `adapter` decides what `vite build` emits as the server: `node()`, `bun()`
  and `deno()` give `dist/server.js`, `cloudflare()` a Worker. `vite dev` works without one. See
  [Adapters](/guides/deployment/#adapters).
- `renderers` lists the [renderers](/renderers/). A component whose
  extension no renderer claims fails with a message that names the package
  to install. [Script droplets](/renderers/script/) need none: their
  renderer is built in.
- `css` covers stylesheets: the one every droplet shares, scoping and
  Tailwind. See [`css`](#css).

### `css`

```ts
droplets({
  css: {
    path: "./src/app.css", // the shared stylesheet; false for none
    scoped: true,          // confine every stylesheet to the element
    tailwind: false,       // true: add @tailwindcss/vite
    twPreflight: true,     // false: leave Tailwind's reset out
  },
});
```

| Option | Default | Meaning |
| --- | --- | --- |
| `path` | `./src/app.css` if it exists | The stylesheet every droplet shares. It comes first in each droplet's `style.css`; `/index.css` serves it too (`404` when it is empty or absent). A path that does not exist fails the build. `false` for none. |
| `scoped` | `true` | Prefix every selector of every stylesheet with the element: the shared one, what droplets import, CSS modules, Svelte and Vue styles. See [Scoping](/guides/styling/#scoping). |
| `tailwind` | `false` | Add `@tailwindcss/vite`, unless the Vite config already has it. Install `tailwindcss` and `@tailwindcss/vite` yourself. |
| `twPreflight` | `true` | Keep Tailwind's preflight (its reset). `false` leaves it out, for host pages that bring their own. No effect without Tailwind. See [Tailwind](/guides/styling/#tailwind). |

Tailwind is detected, not assumed: it is on when `@tailwindcss/vite` is in
the Vite config, whether you put it there or `tailwind: true` did. Without
Tailwind and without a `path`, droplets share no stylesheet.

#### Preflight in dev only

Tailwind's preflight resets margins, borders, fonts and form controls. When
the pages that embed your droplets load Tailwind themselves, they already
have it, and the droplets need not bring a second one. In dev there is no
such page, so keep it there and leave it out of the build:

```ts
export default defineConfig(({ command }) => ({
  plugins: [droplets({ css: { tailwind: true, twPreflight: command === "serve" } })],
}));
```

`twPreflight: false` turns `@import "tailwindcss"` into its theme and
utilities, and removes `@import "tailwindcss/preflight.css"`, in every
stylesheet Vite processes. An import Tailwind resolves inside one of them
(`app.css` importing a file that imports `tailwindcss`) is out of its reach;
the build warns when a preflight gets through that way.

The plugin sets `appType: "custom"`, adds what it needs to `server.fs.allow`,
sets `server.origin` under `vite dev` to the dev server's address (unless you
set it), and in build mode defines the `client`, `ssr` and `server`
environments and an `experimental.renderBuiltUrl` that puts every file URL
on the droplet location (your own `renderBuiltUrl` answers first). Anything
else in `vite.config.ts` is yours; `build.outDir` is respected.
Client externals are declared in
`environments.client.build.rolldownOptions.external`; see
[Import maps](/guides/server/#import-maps).

## Environment variables

| Variable | Effect |
| --- | --- |
| `PORT` | Overrides `server.port` for `node dist/server.js` and `bun dist/server.js`, so a container can relocate the server without a rebuild. An integer from 1 to 65535; any other value is ignored. `vite dev` does not read it: its port is Vite's `server.port`, else `dev.server.port`. |
| `DROPLETS_TRUSTED_ORIGINS` | Comma-separated origins added to `trustedOrigins`, read at runtime (per request, so Workers bindings work). |
| `DROPLETS_ENV_MAX_AGE` | Seconds a browser or CDN may keep `/env.js`, read at runtime: `600` by default, `0` sends `no-store`, an invalid value keeps `600` ([Environment variables](/guides/server/#environment-variables)). |
| `DROPLETS_SECRET` | 32 or more random bytes, read at runtime: signs the result of a form posted without JavaScript, carried back to the page on the redirect ([Post/Redirect/Get](/guides/actions/#without-javascript-postredirectget)). Without it, or shorter, such a post answers the fragment instead, with a warning under `vite dev`. |
| `DEV_DROPLETS_LOG` | The level of the `vite dev` and `vite build` log: `error`, `warn`, `info` (default) or `debug`. A production server ignores it: it logs errors only ([Logging](/guides/deployment/#logging)). |

Your own variables are declared in `src/env.ts`; see
[Environment variables](/guides/server/#environment-variables).

## Config changes in dev

Editing `droplets.config.ts`, `src/env.ts`, or any file either imports,
restarts the dev server: the config shapes routes, ports and the droplet
registry, so a restart is the only safe reaction.

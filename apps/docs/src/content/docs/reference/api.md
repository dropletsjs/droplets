---
title: API
description: "Every file, option, route, environment variable, module, command and package export of Droplets, with its signature and default."
---

This page lists what Droplets reads from your project and what its packages
export. The guides explain how the pieces work together; this page is for
looking a name up.

## Files you write

| File | Exports | Runs |
| --- | --- | --- |
| `src/droplets/<id>/+droplet.<ext>` | the component, and the flags `ssr`, `hydrate`, `prerender` | server and browser |
| `src/droplets/<id>/+droplet.script.ts` (or `.js`) | in place of a component: default `(data, el) => void \| cleanup` ([`DropletScript`](#dropletsjsdroplets)). See [Script droplets](/renderers/script/) | browser |
| `src/droplets/<id>/+droplet.server.ts` (or `.js`) | `load`, `actions`, `handleError`, `entries`, `transform` | server |
| `src/droplets/<id>/+droplet.ts` (or `.js`) | `props` (a Standard Schema), `load`, `handleError` | server and browser |
| `src/droplets/<id>/+error.<ext>` | the error page, in the droplet's framework | server and browser |
| `src/api/**/+server.ts` (or `.js`) | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `HEAD`, `fallback` | server |
| `src/hooks.server.ts` (or `.js`) | `handle`, `handleError` | server |
| `src/hooks.client.ts` (or `.mts`, `.js`, `.mjs`) | `init` ([`ClientInit`](#dropletsjsdroplets)) | browser |
| `src/importmap.server.ts` (or `.js`) | `importmap` | server |
| `src/env.ts` (or `.js`) | `variables`, from `defineEnvVars` | build |
| `src/app.css` | the stylesheet every droplet shares (`css.path`) | build |
| `public/` | files served at `/assets/public/<file>` | build |
| `index.html` | the page `/` serves in a build (`index`) | build |
| `droplets.config.ts` (or `.mts`, `.js`, `.mjs`) | default: the [config](#dropletsconfigts) | build, bundled into the server |

The folder under `src/droplets/` is the droplet's id. It must be lowercase
kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`, `product-card`); any other folder that
holds a component is ignored, and `vite dev` and `vite build` list those
folders in one warning. Only the immediate subfolders are scanned. A folder
with two components, or a component suffix no configured renderer claims,
fails the build. The server modules found by name (`+droplet.ts`,
`+droplet.server.ts`, `+server.ts`, `hooks.server.ts`, `importmap.server.ts`)
are looked up as `.ts` then `.js`; one spelled `.mts`, `.mjs`, `.cts` or `.cjs`
is not loaded, and `vite dev` and `vite build` warn once naming the file and
the name to use.

### Flags

Written as top-level `export const` literals in the component, and nowhere
else: a flag in `+droplet.ts`, `+droplet.server.ts` or `+error.*` is
ignored. A value that is not a literal warns and keeps the default. A script
droplet is always `ssr = false`, `hydrate = true`, `prerender = false`, and
each flag it exports warns once.

| Flag | Values | Default | What it does |
| --- | --- | --- | --- |
| `ssr` | `true`, `false` | `true` | Render on the server. |
| `hydrate` | `true`, `false`, `"visible"`, `"interactive"` | `true` | Ship a browser bundle, and when it runs: at once, near the viewport, or on the first `pointerdown`, `focusin`, `keydown` or `click`. `false` ships no JavaScript. |
| `prerender` | `true`, `false` | `false` | Render at build for the events `entries` returns. |

Svelte writes them in `<script module>`, Vue in the plain `<script>`,
Handlebars in its flags comment. See [Writing droplets](/guides/writing-droplets/)
and each [renderer page](/renderers/).

### `+droplet.server.ts`

```ts
export const load: (event: LoadEvent) => unknown;     // the component's data (plain values or promises)
export const actions: Actions;                         // { default?, [name]: (event: ActionEvent) => data | fail() | redirect() }
export const handleError: HandleDropletError;          // ({ error }) => { error }
export const entries: Entries;                         // () => Array<{ props?, host? }>
export const transform: Transform | Transform[];       // ({ html, ...event }) => string
```

- `load` runs on the server for every render and `_data` request; its
  result is inlined into the fragment.
- `actions` take form posts to `/droplets/<id>?/<name>` (`default` without a
  name). Names match `^[A-Za-z_][\w-]*$`; `__proto__`, `constructor` and
  `prototype` are never actions.
- `entries` returns the renders to make at build when `prerender = true`;
  without it, one render with `{}`. Each event has only `props` (an object)
  and `host` (an absolute URL); anything else fails the build.
- `transform` rewrites the droplet's HTML on every request, prerendered or
  live; a list runs in order and each step must return a string.

### `+droplet.ts`

```ts
export const props: StandardSchemaV1;                  // zod, valibot, arktype…; a mismatch answers 400
export const load: (event: DropletLoadEvent) => unknown;  // { host, props, data } -> the component's data
export const handleError: HandleDropletError;
```

The load files are `+droplet.ts` and `+droplet.server.ts`, each looked up
as `.ts`, then `.js`. A load file spelled `.mts`, `.mjs`, `.cts` or `.cjs` is
not loaded and warns once, under `vite dev` and `vite build`.

### `src/api/**/+server.ts`

Each export is a [`RequestHandler`](#dropletsjsdropletsserver) and must
return a `Response`. Folders map to the URL under `/api`: `[name]` is a
parameter, `[...rest]` a rest parameter (zero or more segments), `(group)`
adds nothing. `HEAD` falls back to `GET` with an empty body; a method
without an export goes to `fallback`, else `405` with `allow`. Routes match
most specific first; two routes of the same shape fail the build.

### `src/hooks.server.ts`

```ts
export const handle: Handle;                // ({ event, resolve }) => Response
export const handleError: HandleServerError; // ({ error, event, status, message }) => { message } | void
```

`handle` runs for every request but the health check, `/index.js`,
`/env.js` and `/assets/*`. `handleError` chooses the message an unexpected
error answers with; without it the message is `Internal Server Error`. See
[Server](/guides/server/) and [Errors](/guides/errors/).

### `src/hooks.client.ts`

`export const init: ClientInit`, `() => void | Promise<void>`: called once
per `/index.js` module, before the droplet element is defined. It may be
async; Droplets never waits for it, and a throw or rejection is logged. See
[In the browser](/guides/in-the-browser/).

### `src/importmap.server.ts`

`export const importmap: ImportMapHandler`,
`({ request, url, externals }) => ImportMap`: the import map for the bare
imports the client build leaves external, served at `importMap`. See
[Shared libraries (import maps)](/guides/import-maps/).

### `src/env.ts`

```ts
import { defineEnvVars } from "@dropletsjs/droplets/env";

export const variables = defineEnvVars({
  API_KEY: {},                                      // private, read at runtime
  SHOW_DEBUG: { static: true },                     // private, inlined at build
  PUBLIC_API_URL: { public: true },                 // reaches the browser, read at runtime (/env.js)
  PUBLIC_SITE_NAME: { public: true, static: true }, // reaches the browser, inlined at build
});
```

Values come from Vite's `loadEnv` for the mode at build and in `vite dev`,
and from the runtime at run time. A `static` variable without a value fails
`vite build` and warns under `vite dev`.

### `./$types`

`vite dev`, `vite build` and `djs sync` write one `$types.d.ts` per droplet
under `.droplets/`, mapped next to the droplet by `.droplets/tsconfig.json`.
It exports `Props`, `ServerData`, `Data`, `ErrorData`, `LoadEvent`,
`DropletLoadEvent`, `ServerLoad`, `Load`, `ActionEvent`, `Actions`,
`DropletActions`, `ActionData`, `DropletProps` and `DropletErrorProps`
(with the renderer's own `children` type), and `DropletScript` for a script
droplet.

## `droplets.config.ts`

```ts
import { config } from "@dropletsjs/droplets";

export default config({ element: "my-widgets", cors: true });
```

The default export is an object, or a function Vite calls with its
`ConfigEnv`. It is bundled into the server at build and never read at run
time; under `vite dev` an edit restarts the server. Unknown keys are
dropped without a warning. A value that fails its check throws a
`droplets:` error naming the option. See [Configuration](/guides/configuration/).

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `dropletsFolder` | `string` | `"src/droplets"` | The folder scanned for `<id>/+droplet.<ext>`. |
| `apiFolder` | `string` | `"src/api"` | The folder scanned for `**/+server.ts`, served under `/api`. |
| `element` | `string` | `"djs-droplet"` | The custom element every droplet renders in. Must match `^[a-z][a-z0-9._]*-[a-z0-9._-]*$`. Give each droplets server its own, so several can share a page. |
| `location` | `string` | not set: computed per request | Where browsers reach this server, fixed at build: an `http(s)` origin with an optional path prefix (`"https://shop.example/mfe"`). No credentials, `*`, `\`, `?` or `#`; the prefix starts with `/`, is at most 256 characters and has no `//` or `..`; trailing slashes are trimmed. With it, no location header is read. `vite dev` ignores it. |
| `host` | `string` | not set: taken from each request | The origin of the page every droplet renders on, fixed at build (`"https://shop.example"`, no path; `"*"` throws). `event.host` is this origin, with the path and query the request reports when it reports this origin. It joins the origins a form may post from and an action may redirect to, and prerendering renders an entry without its own `host` there. `vite dev` ignores it. |
| `trustedOrigins` | `string[]` | `[]` | Origins besides this server's own that may post forms, receive action redirects, and name the location in `x-droplet-location` or forwarded headers. Bare origins or `"*"` (any; warned about under `vite dev`, never as a redirect target). When the list is set, a `host` outside it becomes this server's origin. `DROPLETS_TRUSTED_ORIGINS` adds to it. |
| `cors` | `boolean \| DropletsCorsOptions` | not set: no CORS headers | Cross-origin access to every route. `true` is `{ origin: "*" }` (warned about under `vite dev`); an object is Hono's `cors()` options. `Link` and `x-droplets-build` are always exposed. |
| `csrf.checkOrigin` | `boolean` | `true` | Answer `403` to a form-urlencoded, multipart or `text/plain` `POST`, `PUT`, `PATCH` or `DELETE` to `/droplets/*`, `/api/*` or the import map whose `Origin` is not this server, `host` or in `trustedOrigins`. One without `Origin` is refused too. |
| `limits` | `{ json?, form?, multipart?, props? }` | `1 MB`, `1 MB`, `10 MB`, `8 KB` | Largest bodies in bytes: JSON, form-urlencoded and `text/plain`, multipart and any other type (`413`), and the `x-droplet-props` header (`431`). Positive numbers; `Infinity` lifts one. |
| `fragmentCacheControl` | `string \| false` | `"private, no-store"` | The `Cache-Control` of fragments and `_data` when neither the load (`setHeaders`) nor `handle` set one. `false` sends none. A non-empty value without line breaks. |
| `publicCacheControl` | `string \| false` | `"no-cache"` | The `Cache-Control` of `/assets/public/*`, on every adapter, with an `ETag` and `304`. `false` sends none. Same check as `fragmentCacheControl`. |
| `health` | `string \| false` | `"/health"` | The path answering `ok`, before `handle`. `false` turns it off. |
| `index` | `string \| false` | `index.html` in the root, else a placeholder page | What `/` serves in a build and `vite preview`: an HTML file relative to the root, served as written. `false` answers `404`; a path that does not exist fails the build. Under `vite dev`, `/` is the devtools page when they are installed. |
| `importMap` | `string \| false` | `"/importmap"`, only while the client build has externals | Where the import map is served: `<path>` as a `<script type="importmap">` block, `<path>.js` as a script that inserts it. Set explicitly, it is always routed. `false` turns both off. |
| `warnImportMap` | `boolean` | `true` | Warn under `vite dev` about externals the map leaves out, keys that are not external, and versions that differ from the installed package. |
| `server.port` | `number` | `8000` | The port `node dist/server.js` and `bun dist/server.js` listen on. `PORT` wins. |
| `dev.server.port` | `number` | `5173` | The `vite dev` port, used when Vite's own `server.port` is not set. `PORT` does not move it. |
| `dev.strategy` | `"hmr" \| "remount" \| "reload" \| "manual"` | `"hmr"` | What a droplet on a page does when its files change under `vite dev`. A page overrides it with `index.js?strategy=…`. Any other value throws. |
| `dev.injectTool` | `boolean` | `false` | Show the dev tool on every page that loads `index.js` under `vite dev` (needs `dropletsDevtools()`). A page overrides it with `index.js?injectTool=…`. |

`health` and `importMap` must start with `/`, hold no `?`, `#` or
whitespace, may not be `/`, `/index.js`, `/env.js`, `/index.css` or a path
under `/droplets`, `/assets` or `/api`, and may not answer the same path as
each other.

With `location` set, `vite build` writes it into the server bundle and every
URL the server writes about itself is on it, `vite preview` and
`wrangler dev` included. With both `location` and `host` set, the build
holds no host or location token and no code to replace one.

## `@dropletsjs/droplets/vite`

```ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { node } from "@dropletsjs/adapter-node";
import { svelte } from "@dropletsjs/renderer-svelte";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [svelte()] })],
});
```

`droplets(options?: DropletsPluginOptions): PluginOption[]`

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `configFile` | `string` | `droplets.config.{ts,mts,js,mjs}` in the Vite root | The config file, relative to the root. One that does not exist throws. |
| `adapter` | `DropletsAdapter` | none | What `vite build` emits as the server. Required for `vite build` and `vite preview`; `vite dev` works without one. The build is Vite's builder (`vite build`, or `createBuilder()` then `buildApp()`): Vite's plain `build()` builds one environment and is refused. |
| `renderers` | `DropletRenderer[]` | `[]` | The frameworks. The built-in script renderer is added after them. Two renderers may share an extension only when both declare `packages`. |
| `css.path` | `string \| false` | `"./src/app.css"` when it exists | The stylesheet every droplet shares: first in each droplet's `style.css`, and served at `/index.css`. |
| `css.scoped` | `boolean` | `true` | Prefix every selector of the build's stylesheets with the element (`html`, `body`, `:root` and `:host` become the element). Added after your own PostCSS plugins: an inline `css.postcss`, else your PostCSS config file, loaded with its options; a file that fails to load fails the build. |
| `css.tailwind` | `boolean` | `false` | Add `@tailwindcss/vite` when the Vite config lacks it. Needs `tailwindcss` and `@tailwindcss/vite` installed. |
| `css.twPreflight` | `boolean` | `true` | Keep Tailwind's preflight. `false` turns `@import "tailwindcss"` into its theme and utilities. |

Also exported, for renderers that read flags themselves:

- `readExportedFlags(source, where, lang?)`: the flags a module's top-level
  `export const` literals set, as `Partial<RenderFlags>`. `lang` is `"js"`,
  `"jsx"`, `"ts"` or `"tsx"` (the default); a source that does not parse
  declares none, and comments and strings never count.
- `readExportedFlag(source, name, where, lang?)` and
  `readExportedHydrate(source, where, lang?)`: one flag.
- Types: `DropletsPluginOptions`, `DropletsCssOptions`, `FlagSourceLang`,
  `DropletsPluginApi`, `DropletSummary`, `DropletRegistryPayload`,
  `DropletsAdapter`, `AdapterBuildContext`, `AdapterPreviewContext`,
  `DropletRenderer`.

`DropletsPluginApi` is the core plugin's `api`, for companion plugins under
`vite dev`: `element()`, `strategy()`, `droplets()`, `renderers()`,
`dropletsRoot()`, `importMapPath()`, `fetch(request)` (the dev app in
process; throws outside `vite dev`), `loaderUrl` (`/index.js`),
`syncTypes()` and `setDevTool(url)`.

## Routes

What a droplets server answers, in `vite dev`, `vite preview` and
production. The [HTTP contract](/integrate/http-contract/) covers the same
routes from a host's side.

| Route | Answers | `Cache-Control` |
| --- | --- | --- |
| `GET /index.js` | The loader: defines the element. In a build, the file `dist/client/index.js`, which imports `./env.js` (when there are runtime public variables) and `./assets/index.<hash>.js`. | `no-store` |
| `GET /env.js` | The public variables read at runtime, as a script; reads nothing from the request. `404` without such a variable. | `public, max-age=600`; `DROPLETS_ENV_MAX_AGE` sets the seconds, `0` is `no-store` |
| `GET /assets/*` | The client build's `assets/` folder: the entry, shared chunks, stylesheets, imported files. Served by the adapter. | `public, max-age=2592000, immutable` |
| `GET /assets/public/*` | The project's `public/` folder, with an `ETag`; `304` when `If-None-Match` matches. Nothing of `public/` is served at the root. | `publicCacheControl` |
| `GET /index.css` | An `@import` of the shared stylesheet (`css.path`), for a page that links it itself; in a build, the file `dist/client/index.css`. `404` when there is none or it is empty. | `no-store` |
| `GET /droplets/:id/client.js` | The droplet's browser bundle; `404` for an unknown droplet or `hydrate = false`. | `public, max-age=2592000, immutable` |
| `GET /droplets/:id/style.css` | An `@import` of each of the droplet's stylesheets; `404` when it has none, and always under `vite dev`. | `public, max-age=2592000, immutable` |
| `GET /droplets/:id` | The fragment: the element with the markup, its inline data and context. Props from the query, else the base64 JSON `x-droplet-props` header. | `fragmentCacheControl` |
| `POST /droplets/:id` | With a JSON body `{ props?, host? }` (or `{ context: { props, host } }`): the fragment. With a form body: an [action](#form-actions). `text/plain` answers `415`; a JSON body with `?/name` answers `400`. | `fragmentCacheControl` |
| `GET`, `POST /droplets/:id/_data` | `{ data }`, plus `form` when a no-JavaScript result is carried; a failed load is `500 { error }`. `PUT`, `PATCH`, `DELETE` answer `405` with `allow: GET, POST`. | `fragmentCacheControl` |
| `ALL /api`, `/api/*` | `+server.ts` endpoints; `404 { "message": "Not Found" }` without a match. | the handler's |
| `GET /health` | `ok`, before `handle` (the `health` option). | none |
| `GET`, `POST /importmap`, `/importmap.js` | The import map, as a block or as a script that inserts it; `404` when there is none (the `importMap` option). | `no-store` |
| `GET /` | The `index` page; `404` with `index: false`. | none |

`handle` never runs for `/index.js`, `/index.css`, `/env.js`, `/assets/*` and the health
check. An unknown droplet id answers `404`. Every answer carries the `cors`
headers when `cors` is set.

### Fragment requests

| Input | What it does |
| --- | --- |
| Query keys | The props, as strings, minus the reserved keys `__cb`, `c`, `t`, `noSSR`, `clientOnly`, `__droplet_return`, any key starting with `/` and any key starting with `__droplet_form_`. |
| `x-droplet-props` | Base64 JSON props, read when the query has none; a malformed value is ignored. |
| `?noSSR` | No server markup; the load still runs and its data is inlined. |
| `?clientOnly` | No server markup and no inline data. |
| `x-droplet-location`, `Forwarded`, `X-Forwarded-Host`/`-Proto`/`-Port`/`-Prefix` | The droplet location, when its origin is the request's own or trusted (`trustedOrigins`, `DROPLETS_TRUSTED_ORIGINS`), in that order; else the request's own origin. Ignored with `location` set. |
| `Origin` | `event.host` when the body names none (not read with `host` set). |

| Response header | What it carries |
| --- | --- |
| `Link` | `preload` for `style.css` and each stylesheet, `modulepreload` for the entry and, for `hydrate = true`, `client.js`. On the droplet location. |
| `Vary` | `x-droplet-location`, `forwarded`, `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-port`, `x-forwarded-prefix`, `origin`; with `location` set, `origin` only. |
| `x-droplets-build` | The build hash, on every fragment and `_data` answer, `404` and `405` included. |

A fragment answers `200`, the action's status after an action, or `500`
with the error page when a load failed. A no-JavaScript result carried back
makes the answer `private, no-store`.

### Form actions

`POST /droplets/<id>?/<name>` with a form-urlencoded or multipart body runs
action `name` (`default` without one). The droplet, its `actions` and the
name are resolved before the body is read; the action reads it.

| Case | Answer |
| --- | --- |
| Two `?/name` keys | `400 One action per request: ?/name once` |
| No `actions` export | `405`, `allow: GET` |
| No action by that name | `404 No action named "<name>"` |
| `accept` prefers `application/json` to `text/html` (by weight; `*/*` alone does not count) | `{ type: "success", status: 200, data? }`, `{ type: "failure", status, data? }` with the failure's status, or `200 { type: "redirect", status, location }` |
| A native post, with `DROPLETS_SECRET` | `303` back to the page (`__droplet_return` or the `Referer`, on this server, `host` or a trusted origin; else `400`), the result signed in `__droplet_form_<droplet>_<build>` |
| A native post, without `DROPLETS_SECRET` | The fragment, rendered with `form` |
| `redirect()` from the action | `303` (native) or the JSON redirect, only to this server, `host` or a listed trusted origin (`"*"` never counts); else `400` in both modes |
| Data that is not plain JSON | `500` |

A signed result lives 5 minutes and is bound to the droplet, the build and
the page. Its data travels only up to 2 KB. See [Actions](/guides/actions/).

## Environment variables

The framework reads these, and no others. A production server on Node, Bun
or Deno reads them from `process.env`, a Worker from its vars and secrets;
under `vite dev`, from Vite's `loadEnv` for the mode (`.env` files and the
process).

| Variable | Read | What it does |
| --- | --- | --- |
| `DROPLETS_TRUSTED_ORIGINS` | per request | A comma-separated list added to `trustedOrigins`. A malformed entry is skipped (warned about under `vite dev`). |
| `DROPLETS_SECRET` | per request | The key that signs no-JavaScript action results, at least 32 bytes. Missing or shorter, it is ignored and a native post answers the fragment instead of a `303`. |
| `DROPLETS_ENV_MAX_AGE` | per request | The `max-age` of `/env.js` in seconds; `0` is `no-store`. Any other value keeps `600` (warned about under `vite dev`). |
| `PORT` | at start | Overrides `server.port` for `node dist/server.js` and `bun dist/server.js`. Empty, `0` or not a number counts as unset. `vite dev`, Deno (`deno serve --port`) and Cloudflare do not read it. |
| `DEV_DROPLETS_LOG` | first log line | The level of the `vite dev` and `vite build` log: `error`, `warn`, `info` (default) or `debug`, any case. A production server ignores it. |

Your own variables are declared in [`src/env.ts`](#srcenvts) and read
through `$droplets/env/public` and `$droplets/env/private`.

## `$droplets/*` modules

Declared by `@dropletsjs/droplets/ambient` (add it to `compilerOptions.types`).

| Module | Exports | Where |
| --- | --- | --- |
| `$droplets/env` | `browser`, `dev`, `building` | anywhere |
| `$droplets/env/public` | `env`: the `public: true` variables, `static` ones inlined, the rest read at runtime (in the browser from `/env.js`) | anywhere |
| `$droplets/env/private` | `env`: every other variable | server files only |
| `$droplets/drop` | `droplet` (also the default export): the droplets server's location | anywhere |
| `$droplets/form` | `actionUrl` (also the default export), `enhanceDropletForm`, their types | anywhere |
| `$droplets/server` | everything [`@dropletsjs/droplets/server`](#dropletsjsdropletsserver) exports | server files only |

`building` is `true` while `vite build` prerenders. The `env` objects are
frozen.

Server files are files named `*.server.*`, `+server.*` routes, and files
under a `server/` folder, in any case (`Server/`, `db.SERVER.ts`). Importing
`$droplets/server`, `@dropletsjs/droplets/server` or `$droplets/env/private`
from any other file fails the build and the `vite dev` import, and no server file may reach a browser bundle through any import
chain; the error names the chain. See [Security](/guides/security/).

### `$droplets/drop`

```ts
import { droplet } from "$droplets/drop";

const response = await fetch(droplet.url("/api/counter"));
```

| Export | What it is |
| --- | --- |
| `droplet.origin` | The droplet location: where the browser loads `/index.js` from, path prefix included, without a trailing slash. |
| `droplet.url(path)` | `origin` and `path` joined with one slash: one of your `/api` endpoints, a file of `public/` (`droplet.url("assets/public/robots.txt")`), or any other route. An absolute URL, such as an imported file's, comes back as it is. |

A droplet runs inside someone else's page, so `fetch("/api/counter")` would
reach the host. In the browser, `origin` is where the page loaded
`/index.js` from; before `/index.js` recorded it, the root of the build the
bundle came from (`https://shop.example/mfe` for a bundle at
`https://shop.example/mfe/droplets/cart/client.js`). On the server it is the
request's droplet location: a trusted location header, else the request's
own origin.

Outside a request on the server (a module's top level) `origin` is the
build's location token,
`http://droplets.invalid/__$DROPLET_LOCATION_<nonce>$__`. A fragment, its
inline data, `_data` and an action's JSON answer get it replaced with the
location of the request they answer. A `+server.ts` response is not
rewritten: call `droplet.url()` inside the handler, and pass an imported
file's URL through it (`droplet.url(logo)`) to put it on the request's
location.

With [`location`](#dropletsconfigts) set, a build writes no token: `origin`
is `location` everywhere on the server, and imported files' URLs are on it
already. `vite dev` always computes it per request.

### `$droplets/form`

```ts
import { actionUrl, enhanceDropletForm } from "$droplets/form";
import type { DropletActions } from "./$types";

actionUrl<DropletActions>("add"); // https://drops.example/droplets/cart?/add&productId=p1&__droplet_return=…
const stop = enhanceDropletForm<DropletActions>(form, { action: "add" });
```

`actionUrl(name?, { droplet?, props? }?)` returns
`<location>/droplets/<id>?/<name>&<props>&__droplet_return=<page>`: the
action `name` (`default` without one) of the droplet rendering now, on the
same location as `droplet.origin`, for the page the form is on (origin and
path of `event.host` on the server, of `window.location` in the browser).
It is the same string on the server, in the browser and in a prerender.
Props that are strings, numbers or booleans go in the query; reserved keys
never do. Outside a render it needs `{ droplet }` (and `{ props }`), and it
throws for a name that does not match `^[A-Za-z_][\w-]*$`. In the browser it
knows the render only while the component renders synchronously: call it as
the component sets up (`useState(() => actionUrl("add"))` in React, Preact
and Hono JSX). With `DropletActions` it takes only the exported names.

`enhanceDropletForm(form, options?)` enhances one form and returns the
function that removes it. A `POST` with a form-urlencoded or multipart body
into `_self`, to exactly `<location>/droplets/<id>` of its own droplet, goes
by `fetch` with `accept: application/json` and `redirect: "manual"`; the
droplet renders again with `form` (or the page follows an absolute
`http(s)` redirect), and `droplets:action` is dispatched on `window`.
Anything else is left to the browser. A submit while one is in flight is
ignored.

| Option | What it does |
| --- | --- |
| `action` | Only this action is intercepted; with `DropletActions`, one of its names, and `onResult`'s `data` is that action's. |
| `onSubmit({ form, formData, cancel })` | Before anything is sent: change `formData`, or `cancel()`. |
| `onResult({ type, status, data, update })` | In place of the default; `update()` does the default. A redirect also has `location`. |

Types: `ActionUrlOptions` (`{ droplet?, props? }`), `ActionMap`,
`ActionName`, `EnhanceOptions`, `ActionEnhanceOptions` (with `action`),
`AnyEnhanceOptions` (without), `EnhanceSubmit`, `EnhanceResult`,
`DropletActionDetail` (`detail` of `droplets:action`).

## `@dropletsjs/droplets/server`

The module `$droplets/server` resolves to, under the same rule: server files only.

| Export | What it is |
| --- | --- |
| `error(status, message?)` | Throws an `HttpError` (`400`–`599`; any other status throws). In `handle`, `+server.ts` and a load it answers with its status and message; in a load it skips `handleError` and `+error.*`. Without a message, the status text. |
| `redirect(status, location)` | Throws a `Redirect`: status `300`, `301`, `302`, `303`, `307` or `308`, to an `http(s)` URL or a path on the site. `javascript:` and other schemes, protocol-relative (`//…`, `/\…`) targets and control characters throw. From an action, see [Form actions](#form-actions). |
| `fail(status, data?)` | An action's failure: an `ActionFailure` with a `400`–`599` status; the component gets `data` as `form`. Return it (or throw it). |
| `json(data, init?)`, `text(body, init?)` | Response helpers: `content-type: application/json`, `text/plain; charset=utf-8`, unless `init` sets one. |
| `sequence(...handles)` | Chains `handle` functions; each one's `resolve` calls the next. |
| `hostFrom(value)` | A `URL` for `handle` to set as `event.host`: an `http(s)` URL without credentials or hash, within `trustedOrigins` (or this server) when the list is set; `null` otherwise. `event.host = hostFrom(event.request.headers.get("referer")) ?? event.host`. |
| `isHttpError(value)`, `isRedirect(value)`, `isActionFailure(value)` | Brand checks, for a `try` that needs to tell them apart; they work across bundle copies. |
| `HttpError`, `Redirect`, `ActionFailure` | The classes: `{ status, body: { message } }`, `{ status, location }`, `{ status, data }`. |
| `HostUrlPropsErrorInPrerender`, `isHostUrlPropsErrorInPrerender(value)` | Thrown when a render made at build without a known host reads a field of `host` other than `origin`, `pathname` and `href`; stops the build. |
| `CookiesInPrerenderError`, `isCookiesInPrerenderError(value)` | Thrown when anything uses `cookies` while prerendering; stops the build. |

Types:

| Type | What it is |
| --- | --- |
| `RequestEvent<Params>` | `{ request, url, host, params, locals, platform, cookies, fetch }`. `url` is the request on the droplet location's origin; `host` is the page the droplet renders on; `fetch` answers a URL on this server in-process, with the request's cookies, and sends any other to the global `fetch` ([`event.fetch`](/guides/server/#eventfetch)). |
| `LoadEvent` | A server load's event: `{ request, host, locals, platform, cookies, setHeaders, droplet, props, fetch }`; `cookies` are `ReadonlyCookies`. |
| `ActionEvent` | An action's event: as `LoadEvent`, with full `cookies` and the body unread. `props` come from the action URL's query, never the body. |
| `DropletLoadEvent` | A universal load's event: `{ host, props, data }`; in the browser `host` is `window.location`. |
| `Action`, `Actions`, `ActionResult` | One action, the `actions` export, and an action's JSON answer. |
| `SetHeaders` | `setHeaders` of a load or action: headers for the fragment and `_data`, each once, never `set-cookie`. |
| `Cookies`, `ReadonlyCookies`, `CookieParseOptions`, `CookieSerializeOptions` | `event.cookies`: `get`, `getAll`, `set`, `delete`, `serialize`. `path` is required; `httpOnly`, `secure` and `sameSite: "lax"` are on unless turned off (`secure` is off over plain HTTP to a loopback host). |
| `Locals`, `Platform` | Interfaces to augment: `event.locals`, and `{ env?, context? }` from the runtime (bindings and execution context on Workers). |
| `Handle`, `ResolveFunction`, `HandleServerError`, `HandleServerErrorInput`, `HandleDropletError` | The hooks. |
| `RequestHandler<Params>` | A `+server.ts` export. |
| `Entries`, `PrerenderEntry`, `Transform`, `TransformInput`, `TransformEvent` | Prerendering and HTML rewriting. `TransformEvent` is a `LoadEvent` without `setHeaders`, with `html`. |
| `ImportMap`, `ImportMapEvent`, `ImportMapHandler` | `src/importmap.server.ts`. |

## `@dropletsjs/droplets/env`

| Export | What it is |
| --- | --- |
| `defineEnvVars(vars)` | Checks the declaration `{ NAME: { public?, static? } }` and returns it unchanged, typed. |
| `validateEnvDeclaration(vars)` | The check alone: throws for a name that does not match `^[A-Za-z_][A-Za-z0-9_]*$` or a value that is not an options object. |
| `EnvVarOptions`, `EnvDeclaration` | Types of one variable's options and of the declaration. |
| `Register` | The interface to augment with `variables`, to type `$droplets/env/*`. |
| `PublicEnv`, `PrivateEnv` | The types of `env` in `$droplets/env/public` and `$droplets/env/private`. |

```ts
declare module "@dropletsjs/droplets/env" {
  interface Register { variables: typeof variables }
}
```

## `@dropletsjs/droplets/enhance`

`enhanceDropletForm` and its types, as `$droplets/form` re-exports them,
with the steps it is made of, for the renderers' form wrappers.

| Export | What it is |
| --- | --- |
| `enhanceDropletForm(form, options?)` | As in [`$droplets/form`](#dropletsform). |
| `enhanceSubmit(event, form, options?)` | One submit: what `enhanceDropletForm` runs on `submit`. |
| `submitterOf(event, form)` | The button or input that submitted `form`, `null` for none. |
| `submission(form, submitter, base)`, `Submission` | The `action` (resolved against `base`), `method`, `enctype` and `target` the submit would use, the submitter's `form*` attributes over the form's. |
| `interceptable(submit)` | Whether a submission is one an enhanced form takes: a `POST`, form-urlencoded or multipart, into `""` or `_self`. |
| `ownAction(action, location, droplet)`, `ActionTarget` | `{ url, name }` when the action is exactly `<location>/droplets/<droplet>`; else `null`. |
| `formBody(data, enctype)` | `FormData` for multipart, else `URLSearchParams`. |
| `actionAnswer(body)`, `ActionAnswer` | An action's JSON answer, checked with own keys only; `null` for anything else. |
| `redirectTarget(location)` | `location` when it is an absolute `http(s)` URL without credentials; else `null`. |
| `plainCopy(data)` | A copy through JSON, for the `droplets:action` detail. |
| `ACTION_EVENT`, `DropletFormHost` | `"droplets:action"`, and the element's `actionTarget()` and `updateForm()`. |

## `@dropletsjs/droplets`

The config helpers, the types, and the contracts for renderers and
adapters. The Vite plugin is in [`./vite`](#dropletsjsdropletsvite).

| Export | What it is |
| --- | --- |
| `config(options)` | Returns `options`, typed as `DropletsConfig`, for `droplets.config.ts`. |
| `resolveConfig(user, env?)` | The config with defaults filled in and checked; `env` is `{ port? }`, the `PORT` value. Throws for an invalid value. |
| `isValidElementName(name)` | `true` when `name` is usable as `element`. |
| `DropletRenderError` | What `+error.*` receives when a load failed with nothing to say: an `Error` named `DropletRenderError`, message `Internal Error` by default. |
| `ActionFailure`, `HostUrlPropsErrorInPrerender`, `CookiesInPrerenderError` | The classes of `./server`, for code that is not a server file. |
| `createServerApp({ ssr, assets, config })` | The production app (a Hono app, `DropletsApp`) over the SSR bundle and an adapter's asset loaders. Throws when the SSR bundle exports no `renderDroplet`. |
| `createPrerenderedLoader(read)` | Looks up prerendered renders through `read(path) => Promise<string \| null>`. |
| `PRERENDER_DIR` | `"_prerendered"`: `dist/server/_prerendered/`, or `dist/client/_prerendered/<random>/` (named only in the manifest) for an adapter without `dist/server`. |
| `setRuntimeEnv(values)` | Hands the runtime environment to the framework and `$droplets/env/*`; where it is not called, `process.env` is read. |
| `FALLBACK_MANIFEST` | The manifest a runtime answers with before it finds a build: no droplets. |
| `defineRenderer`, `importsPackage`, `parseHydrateMode`, `RENDERER_QUERY`, `rendererScopeFilter`, `validateRenderers`, `withFlagDefaults` | The [renderer contract](#renderer-contract) helpers. |

Types:

| Type | What it is |
| --- | --- |
| `DropletsConfig`, `ResolvedDropletsConfig`, `DropletsCorsOptions`, `BodyLimits`, `DevStrategy` | The config, resolved and not. |
| `DropletProps<Data, Children, Form>`, `DropletErrorProps<Err, Children>` | Component props, framework-neutral; each renderer exports versions with its own `children` type. |
| `DropletScript<Data>` | A script droplet's default export: `(data: Data, el: HTMLElement) => void \| (() => void)`. |
| `InferSchemaOutput<Schema>` | A Standard Schema's output type: how `./$types` types `Props`. |
| `ClientInit` | `init` in `src/hooks.client.ts`. |
| The event, hook, cookie, action, prerender and import map types | As [`./server`](#dropletsjsdropletsserver) exports them. |
| `DropletStaleDetail`, `DropletRenderInfo`, `DropletChildrenHost` | `detail` of `droplets:stale`; what the element knows about a render; the children callbacks. |
| `DropletUpdatePayload`, `DevNotification`, `RenderContract`, `DevToolSource`, `DevElementInfo`, `DevElementState`, `DropletsDevTools` | The `vite dev` HMR payload and the dev tool's contract. |
| `LogLevel`, `LogSource` | `"error" \| "warn" \| "info" \| "debug"`; `"framework" \| "drop"`. |
| `DropletMeta`, `RenderResult`, `DropletPayload`, `PrerenderedDroplet`, `DropletsApp` | Render flags and outputs, for tooling; the app type. |
| `DropletsManifest`, `DropletManifestEntry` | `dist/client/droplets.json`. |
| `AssetLoaders`, `ServerAppOptions`, `SsrModule` | `createServerApp`'s types. |
| `DropletsAdapter`, `AdapterBuildContext`, `AdapterPreviewContext` | The [adapter contract](#adapter-contract). |

### Renderer contract

A renderer is a factory that returns a `DropletRenderer`. The contract is
documented in full in `packages/droplets/src/renderer.ts`; every renderer
passes [`rendererConformance()`](#dropletsjsdropletstesting).

| Field of `DropletRenderer` | What it is |
| --- | --- |
| `name` | Unique among the configured renderers. `script` is the built-in renderer's. |
| `extensions` | Suffixes after `+droplet`/`+error`: `[".svelte"]`, `[".tsx", ".jsx"]`. `.ts`, `.js`, `.server.ts`, `.server.js`, `.d.ts`, `.server.d.ts`, `.script.ts` and `.script.js` are core's. |
| `packages?` | The engine's packages and the renderer's own; required to share an extension, and what another renderer's droplet may not import. |
| `suffixes?` | Other files of the engine (`.svelte.ts`). |
| `componentTypes?` | The module whose `DropletProps` and `DropletErrorProps` a droplet's `./$types` uses. |
| `plugins?` | Vite plugins, or `(scope: RendererScope) => PluginOption[]`; `scope.include` matches the modules tagged `?droplets-renderer=<name>` when another renderer shares an extension. |
| `server` | Absolute path of a `RendererServerModule`: `render(module, props, context) => string \| { html, head? }`. |
| `client` | Absolute path of a `RendererClientModule`: `mount`, `hydrate`, `unmount`. |
| `clientSetup?` | Absolute path of a module imported for its side effects before anything renders. |
| `clientDev?` | Absolute path of a `RendererClientDevModule`: `update(instance, props)`, new props for a live instance. Under `vite dev` and in non-production builds only. |
| `readFlags?` | `(input: ReadFlagsInput) => Partial<RenderFlags>`: flags from the component's source; without it, its top-level `export const`s. |

| Helper | What it is |
| --- | --- |
| `defineRenderer(renderer)` | Returns `renderer`, typed. |
| `validateRenderers(renderers)` | The checks the plugin runs: names, extensions, shared extensions without `packages`, missing `server`/`client`. |
| `importsPackage(source, pkg)` | Whether source imports `pkg` or a subpath of it, or names it in `@jsxImportSource`. |
| `rendererScopeFilter(name)`, `RENDERER_QUERY` | The `include` pattern for one renderer, and `"droplets-renderer"`. |
| `parseHydrateMode(value)`, `withFlagDefaults(flags)` | A `hydrate` value from text; flags with defaults filled in. |

Types: `RendererServerModule`, `ServerRenderContext` (`droplet`, `kind`,
`renderId`, `actionUrl`), `ServerRenderOutput`, `RendererClientModule`,
`ClientRenderContext` (adds `children`, `rendering?`, `markers()`, `error?`),
`RendererClientDevModule`, `RendererScope`, `ActionUrl`, `RenderFlags`,
`HydrateMode`, `ComponentKind`, `ComponentModule`, `RenderProps`
(`{ data, form? }` or `{ error }`), `ReadFlagsInput`.

### Adapter contract

```ts
type DropletsAdapter = {
  name: string;
  serverEntry: string;              // absolute path Vite bundles as the server
  serverFile: string;               // "server.js", inside the output directory
  separateSsrBundle: boolean;       // also emit dist/server/entry-server.js
  noExternal?: Array<string | RegExp> | true;
  environment?: EnvironmentOptions; // merged into the server build environment last
  afterBuild?: (context: AdapterBuildContext) => void | Promise<void>;
  preview?: (context: AdapterPreviewContext) => Promise<{ fetch(request: Request): Response | Promise<Response> }>;
};
```

`afterBuild` runs once every environment is built, with
`AdapterBuildContext`: `root`, `outDir`, `manifestPath` (the emitted
`droplets.json`), `serverPath` (the emitted server file) and `config` (the
resolved `droplets.config.ts`). `preview` gets `root`, `outDir` and `config`;
without it, `vite preview` warns and serves nothing.

An adapter entry imports `virtual:droplets-config` (the config),
`virtual:droplets-ssr` (the SSR bundle, when it inlines it) and
`virtual:droplets-manifest` (`droplets.json`), declared by
`@dropletsjs/droplets/ambient`, and serves `createServerApp` with its
`AssetLoaders`. `packages/adapters/node` and `packages/adapters/cloudflare`
are the reference.

## `@dropletsjs/droplets/postcss`

- `scopeStylesPlugin({ element, include? })`: the PostCSS plugin behind
  `css.scoped`, for a PostCSS pipeline of your own outside Vite.
  `include(file)` picks the stylesheets; all by default. Options type:
  `ScopeStylesOptions`.
- `scopeSelector(selector, element, svelte?)`: the rewrite alone.
  `scopeSelector(".p-4", "x-y")` is `"x-y .p-4"`; with `svelte`,
  `":global(x-y) .p-4"`.

## `@dropletsjs/droplets/testing`

For renderer packages; it imports vitest.

`rendererConformance(options: ConformanceOptions)` is the suite every
renderer passes. It builds a fixture app with the renderer and checks
server rendering, inline data, hydration, client-only mounting, the error
page and boundary, children, prerendering, form actions and their URLs,
native and enhanced submits, Post/Redirect/Get and HMR. The server renders
in a worker thread of its own, so a server build that shims the DOM or
defines custom elements never meets the browser bundles; the DOM checks
look into shadow roots, attached or declarative, and through slots; the
HTML checks ignore an engine's comment markers.

| Option | Default | What it is |
| --- | --- | --- |
| `renderer` | required | The renderer under test. |
| `root` | required | Absolute path of the fixture app (`conformance.ts` documents its layout). |
| `element` | `"test-droplet"` | The element name the fixture config sets. |
| `interactive` | `true` | Whether `hello`'s button increments after hydration; `false` for templates. |
| `css` | `true` | Whether `static-note` carries styles the client build extracts. |
| `adopts` | `true` | Whether hydration adopts the server's DOM nodes. |
| `enhance` | `"wrapper"` | `"attribute"` when forms opt in with `data-droplet-enhance`. |
| `outDir` | `<root>/dist-conformance` | Where the build goes. |

`fakeRenderer()` is a complete reference renderer, named `fake`, for
`.fake.js` components.

## `@dropletsjs/droplets/ambient`

Types only: the `$droplets/*` modules and the adapters' `virtual:*` modules.

```json
{ "compilerOptions": { "types": ["vite/client", "@dropletsjs/droplets/ambient"] } }
```

## Renderers

Each renderer package's root export is the factory, for `vite.config.ts`.
Its `./server` and `./client` exports are the modules core imports by path.

| Package | Factory | Files | Component exports |
| --- | --- | --- | --- |
| `@dropletsjs/renderer-svelte` | `svelte({ plugin?, vitePlugin? })` | `.svelte` | `DropletProps<Data, Form>`, `DropletErrorProps` (`children` a `Snippet`); `./form`: `enhanceDropletForm`, a Svelte action (`use:enhanceDropletForm={options}`) |
| `@dropletsjs/renderer-vue` | `vue({ plugin?, vitePlugin? })` | `.vue` | `DropletProps<Data, Form>`, `DropletErrorProps`; `./children`: `DropletChildren`; `./form`: `useEnhanceDropletForm(formRef, options?)` |
| `@dropletsjs/renderer-react` | `react({ plugin?, vitePlugin? })` | `.tsx`, `.jsx` | `DropletProps<Data, Form>`, `DropletErrorProps`; `./form`: `useEnhanceDropletForm(formRef, options?)` |
| `@dropletsjs/renderer-preact` | `preact({ plugin? })` | `.tsx`, `.jsx` | `DropletProps<Data, Form>`, `DropletErrorProps`; `./form`: `useEnhanceDropletForm(formRef, options?)` |
| `@dropletsjs/renderer-solid` | `solid({ plugin?, vitePlugin? })` | `.tsx`, `.jsx` | `DropletProps<Data, Form>`, `DropletErrorProps`; `./form`: `enhanceDropletForm`, a directive (`use:enhanceDropletForm={options}`) |
| `@dropletsjs/renderer-hono-jsx` | `honoJsx({ plugin? })` | `.tsx`, `.jsx` | `DropletProps<Data, Form>`, `DropletErrorProps`; `./form`: `useEnhanceDropletForm(formRef, options?)` |
| `@dropletsjs/renderer-handlebars` | `handlebars({ partials?, helpers?, compile? })` | `.hbs` | `DropletContext<Data, Form>`, `DropletErrorContext`, `HandlebarsHelpers`; the `{{action "name"}}` and `{{children}}` helpers; `data-droplet-enhance` on a form enhances it |
| `@dropletsjs/renderer-lit` | `lit({ prefix? })` | `.lit.ts`, `.lit.js` | `DropletProps<Data, Form>`, `DropletErrorProps`; `./element`: `DropletElement`, `DropletErrorElement`; `./form`: `enhance(options?)`, an element directive |
| built in | none | `.script.ts`, `.script.js` | `DropletScript` from `./$types` |

| Option | Renderers | Default | What it does |
| --- | --- | --- | --- |
| `plugin` | all but Handlebars and Lit | `true` | `false` leaves adding the framework's Vite plugin (or JSX compile) to you. |
| `vitePlugin` | Svelte, Vue, React, Solid | `{}` | Options for `@sveltejs/vite-plugin-svelte`, `@vitejs/plugin-vue`, `@vitejs/plugin-react` or `vite-plugin-solid`. |
| `partials` | Handlebars | `"src/partials"` | The partials folder, relative to the root; `false` for none. |
| `helpers` | Handlebars | `src/handlebars.ts` (or `.js`) when it exists | The module whose exported functions are helpers; `false` for none. |
| `compile` | Handlebars | none | Options for `Handlebars.precompile`. |
| `prefix` | Lit | the droplets `element` | Tags are `<prefix>-<droplet id>`; must match `^[a-z][a-z0-9-]*$`, else `lit()` throws. |

Each `./form` wrapper applies `enhanceDropletForm` of `$droplets/form` to
one form while it is in the page, with the same options (typed with
`DropletActions`). The URL is `actionUrl()` of `$droplets/form` in every
framework (`this.actionUrl()` in Lit, `{{action}}` in Handlebars). See each
[renderer page](/renderers/).

## Adapters

`vite build` requires one; it fails without, naming `@dropletsjs/adapter-node`.

| Factory | Package | Emits | Run with | Port |
| --- | --- | --- | --- | --- |
| `node()` | `@dropletsjs/adapter-node` | `dist/server.js`, `dist/server/entry-server.js`, `dist/client/` | `node dist/server.js` | `PORT`, else `server.port`, else 8000 |
| `cloudflare({ assetsBinding? })` | `@dropletsjs/adapter-cloudflare` | `dist/worker.js`, `dist/client/` with `_headers` and `.assetsignore` | `wrangler dev`, `wrangler deploy` | wrangler's |
| `bun()` | `@dropletsjs/adapter-bun` | `dist/server.js`, `dist/server/entry-server.js`, `dist/client/` | `bun dist/server.js` | `PORT`, else `server.port`, else 8000 |
| `deno()` | `@dropletsjs/adapter-deno` | `dist/server.js`, `dist/server/entry-server.js`, `dist/client/` | `deno serve -A dist/server.js` | `deno serve --port`, 8000 by default |

- `node()`, `bun()` and `deno()` take no options and serve `vite preview`.
  `dist/server.js` resolves `client/` and `server/` next to itself.
  Importing it does not listen: its default export has
  `fetch(request): Promise<Response>` (Bun's also `port`). The Node build
  also exports `runServer()`, which listens.
- `@dropletsjs/adapter-node` also exports
  `createNodeServerApp(paths: NodeServerPaths, config)`: the production app
  over `{ clientRoot, ssrEntryUrl, serverRoot? }` (`serverRoot` defaults to
  `server` next to `clientRoot`). Bun and Deno use it.
- `cloudflare()`: `assetsBinding` is the Workers Static Assets binding name,
  `"ASSETS"` by default (type `CloudflareAdapterOptions`). The Worker inlines
  the SSR bundle and the manifest, reads files through the binding, and
  takes the Worker's vars and secrets as the runtime environment. After
  each build it writes `dist/client/_headers` (`/index.js` `no-store`,
  `/assets/*`, `client.js` and `style.css` immutable with
  `Access-Control-Allow-Origin: *`, `/assets/public/*` with
  `publicCacheControl`), then appends the project root's own `_headers`. A
  wrangler config whose `assets.run_worker_first` sends build files through
  the Worker gets a warning. It has no `vite preview`.

See [Deployment](/guides/deployment/).

```ts
const droplets = (await import("./dist/server.js")).default;
const response: Response = await droplets.fetch(new Request("http://localhost/droplets/hello"));
```

## `@dropletsjs/devtools`

`dropletsDevtools(): Plugin`, after `droplets()` in the Vite plugins, active
under `vite dev` only (it throws when `droplets()` is missing). It serves the
devtools page at `GET /` (`?droplet=<id>` renders that droplet on the
server), `GET /__droplets/devtools.json` (`{ element, droplets }`,
`no-store`, `access-control-allow-origin: *`), and the dev tool module that
`index.js` imports with `dev.injectTool` or `?injectTool=true`. See
[Development](/guides/development/).

The package also exports the types `DevtoolsPageInput` and `ServerRender`.

## `djs`

The command line of `@dropletsjs/droplets`. Both commands take
`--root <dir>`, `--config <vite config>` and `--mode <mode>`; `-h` prints
the usage.

### `djs sync`

```bash
djs sync
```

Resolves the Vite config, finds the droplets and writes `.droplets/`: each
droplet's `./$types` and the `tsconfig.json` that maps them; the types of a
droplet that is gone are removed, their folders with them. Nothing is
served or built. Use it where `vite` has not run before a type check:
`"prepare": "djs sync"`.

### `djs add`

```bash
djs add [name] [--framework <f>] [--target <t>] [--hydrate <h>] [--with <files>] [--pm <pm>] [--yes]
```

Writes `src/droplets/<name>/` (under `dropletsFolder`), then its `./$types`.
`<name>` is the droplet's id: lowercase kebab-case, starting with a letter
(`hello-world`). In a terminal it asks for what the options leave out; with
`--yes` (`-y`), or without a terminal, it asks nothing and takes the
defaults.

| Option | Values | Default |
| --- | --- | --- |
| `--framework` | `svelte`, `vue`, `react`, `preact`, `solid`, `hono-jsx` (or `hono`), `handlebars`, `lit`, `script` | asked; without a terminal, the only configured renderer (more than one is an error) |
| `--target` | `full`, `ssr`, `client`, `ssg` | `full` |
| `--hydrate` | `always`, `visible`, `interactive`, `none` | asked for `full`; implied by the others |
| `--with` | `server`, `universal`, `error`, `css`, comma-separated | asked; none |
| `--pm` | `npm`, `pnpm`, `yarn`, `bun`, `deno` | the one running `djs`, else the nearest lockfile's, else `npm` |
| `--yes` | | asks nothing and accepts the warnings |

| Target | Flags | Hydrate |
| --- | --- | --- |
| `full` | `ssr` | `always`, `visible` or `interactive`; `none` is an error (that is `ssr`) |
| `ssr` | `ssr`, `hydrate = false` | `none`: HTML and CSS only; another value is the same as `full` |
| `client` | `ssr = false` | `always`; `none` warns of a blank component, `interactive` that it mounts at once |
| `ssg` | `ssr`, `prerender`, an `entries` in `+droplet.server.ts` | `always`; `none` for static HTML |

The optional files are `+droplet.server.ts` (a server load), `+droplet.ts`
(a universal load, where a props schema goes), `+error.<ext>` and styles: a
`<style>` block in Svelte, Vue and Handlebars, a `style.css` the component
imports in React, Preact, Solid and Hono JSX.

A framework the Vite config does not list yet is offered grayed out.
Picking it warns of what follows and asks to go ahead:

- the framework is installed with the package manager, and the renderer as
  a dev dependency at exactly the installed core's version;
- `<factory>()` goes at the end of `droplets({ renderers: [...] })` in
  `vite.config.ts`, with its import. A config it cannot edit with
  confidence is left alone, and `djs add` prints the lines to add;
- for a `.tsx` framework, `tsconfig.json` gets `"jsx": "react-jsx"`, its
  `jsxImportSource`, and `.tsx` files in `include`, unless it sets `jsx`
  already.

Every `.tsx` component it writes names its framework in a
`/** @jsxImportSource … */` comment, so React, Preact, Solid and Hono JSX
droplets can share the project.

`--framework script` writes a [script droplet](/renderers/script/),
`+droplet.script.ts`: nothing to install or register. It takes no
`--target` and no `--hydrate` (both are errors), and `--with` has no
`error`; `css` writes a `style.css` the script imports.

## `create-droplets`

```bash
npm create droplets my-widgets -- --frameworks svelte,react --adapters node,cloudflare --yes
```

In a terminal it asks for what the flags leave out. Without a terminal, or
with `--yes`, the folder and `--frameworks` are required and the rest takes
its default.

| Flag | Does | Default |
| --- | --- | --- |
| `[folder]` | The project folder; one at most. | asked, `my-droplets` |
| `--element <name>` | The custom element. | the folder's package name, `<name>-droplets` when it has no hyphen |
| `--frameworks <list>` | `svelte`, `vue`, `react`, `preact`, `solid`, `hono-jsx` (or `hono`), `handlebars`, `lit`, comma-separated. | asked |
| `--adapters <list>` | `node`, `cloudflare`, `bun`, `deno`, comma-separated. | asked; `node` without a terminal |
| `--tailwind`, `--no-tailwind` | Tailwind CSS in `src/app.css`, `css: { tailwind: true }`. | asked; off without a terminal |
| `--inject-tool` | `dev: { injectTool: true }` in `droplets.config.ts`. | asked; off without a terminal |
| `--claude` | `CLAUDE.md` (`@AGENTS.md`) next to `AGENTS.md`. | asked; off without a terminal |
| `--pm <pm>` | `npm`, `pnpm`, `yarn`, `bun` or `deno`. | the one running it, else the nearest lockfile's, else `npm` |
| `--no-install` | Write the files only. | installs, then runs `djs sync` |
| `--no-git` | No `git init`. | `git init` and a first commit, skipped inside a work tree |
| `--yes`, `-y` | Ask nothing. | |

It writes `package.json` (`dev`, `build`, `preview`, `start`, `sync`,
`prepare`, `typecheck`, and `build:<adapter>`/`start:<adapter>` for every
adapter but the default one; `deploy` or `deploy:cloudflare` with
Cloudflare), `vite.config.ts` (with several adapters it picks one by
`DROPLETS_ADAPTER`, a variable of that file, not of the framework),
`droplets.config.ts` (`element`, `cors: true`), `tsconfig.json` (extending
`.droplets/tsconfig.json`), `src/app.css`, one starter droplet per framework
in `src/droplets/hello-<framework>/`, `AGENTS.md`, `.gitignore`,
`README.md`, `svelte.config.js` with Svelte, `wrangler.jsonc` with
Cloudflare, `.vscode/extensions.json` with Svelte, Vue or Lit (their editor
extensions: `svelte.svelte-vscode`, `Vue.volar`, `runem.lit-plugin`), and
the package manager's settings that install only versions published at
least 7 days ago (`@dropletsjs/*` exempt). A file that exists
already stops it before anything is written. See
[Getting started](/start/getting-started/).

## The droplet element

`<djs-droplet>` by default; `element` renames it. Defined by `/index.js`.

| Attribute | Written by | Meaning |
| --- | --- | --- |
| `data-droplet` | server, host | The droplet id. An unknown id keeps its markup and does nothing. |
| `data-droplet-props` | host | Plain JSON props, read when there is no inline context or `data-droplet-context`. |
| `data-droplet-context` | server, host | Base64 JSON `{ host, props }`, when no `[data-droplet-payload="context"]` is inlined. |
| `data-droplet-hydrate` | host | `true` (or empty), `false`, `visible` or `interactive`: overrides the droplet's mode. It never makes a `hydrate = false` droplet hydrate, and `false` never stops a script droplet. |
| `data-droplet-build` | server | The build that rendered it. |
| `data-droplet-render` | server | The server render's id, when there is server markup. |
| `data-droplet-error` | server | The markup is the error page. |

Children: `<script type="application/text" data-droplet-payload="context">`,
`<script type="application/text" data-droplet-payload="data">`,
`<link rel="stylesheet" data-droplet-style>` to the droplet's `style.css`
(added by the element when the fragment brought none, with
`<link rel="preload" data-droplet-preload>` for the stylesheets it imports),
`<div data-droplet-entry>` with the markup (created when missing), and the
host's `<div data-droplet-slot>`, moved into the component's children
marker. Nothing goes into `<head>`.

| Event | When |
| --- | --- |
| `droplets:stale` | The droplet comes from another build than the loaded `index.js`; it keeps its server HTML and does not hydrate. Bubbles to `window`; `detail` is `{ element, droplet, loaded, served }`. |
| `droplets:action` | An enhanced form's action answered. On `window`; `detail` is `{ droplet, action, type, status, data }`. |

| Method | What it does |
| --- | --- |
| `actionTarget()` | `{ droplet, location, build }`: where this droplet's actions are, and the build of the loaded `index.js`; `null` while it renders no known droplet of this build. |
| `updateForm({ form, action })` | Renders the droplet again with `form`, its loads run again; a droplet that does not hydrate gets its fragment rendered by the server with `form`, and the props and page of `action`, the URL of the droplet's own action that answered (any other URL, or none: the element's own context). What an enhanced form calls. |

A form with `data-droplet-enhance` in a droplet's own markup is enhanced
by the element, for any renderer.

Under `vite dev`, `/index.js` takes `strategy=hmr|remount|reload|manual`
and `injectTool=true|false`. See [Development](/guides/development/).

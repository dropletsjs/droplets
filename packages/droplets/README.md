# @dropletsjs/droplets

Server-rendered components you can embed from any stack, as a Vite plugin on
Hono. Each droplet is one component with its own URL: server-rendered,
independently bundled, embeddable as an HTML fragment into a page served by
anything. Components are written in Svelte, Vue, Solid, React, Preact, Hono JSX,
Handlebars or Lit, through renderers, or as a plain browser script.

The full guide: [dropletsjs.dev](https://dropletsjs.dev).

The quickest start is a new project:

```bash
npm create droplets@alpha my-widgets
```

By hand:

```bash
pnpm add @dropletsjs/droplets@alpha @dropletsjs/renderer-svelte@alpha svelte
pnpm add -D vite typescript @dropletsjs/adapter-node@alpha @dropletsjs/devtools@alpha
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { dropletsDevtools } from "@dropletsjs/devtools";
import { node } from "@dropletsjs/adapter-node";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [svelte()] }), dropletsDevtools()],
});
```

```ts
// droplets.config.ts (optional)
import { config } from "@dropletsjs/droplets";

export default config({ element: "my-widgets", cors: true });
```

```json
// tsconfig.json
{
  "extends": "./.droplets/tsconfig.json",
  "compilerOptions": { "types": ["vite/client", "@dropletsjs/droplets/ambient"] }
}
```

`vite` to develop, `vite build` to build, `node dist/server.js` to run.
`djs add <name>` writes a new droplet; `djs sync` writes `.droplets/` (each
droplet's `./$types`) without starting Vite (`"prepare": "djs sync"`).

## Details

### Renderers and adapters

Node 22+ and Vite 8. Pick the renderers you need:

| Renderer | Package | Files |
| --- | --- | --- |
| `svelte()` | `@dropletsjs/renderer-svelte` | `.svelte` |
| `vue()` | `@dropletsjs/renderer-vue` | `.vue` |
| `solid()` | `@dropletsjs/renderer-solid` | `.tsx`, `.jsx` |
| `react()` | `@dropletsjs/renderer-react` | `.tsx`, `.jsx` |
| `preact()` | `@dropletsjs/renderer-preact` | `.tsx`, `.jsx` |
| `honoJsx()` | `@dropletsjs/renderer-hono-jsx` | `.tsx`, `.jsx` |
| `handlebars()` | `@dropletsjs/renderer-handlebars` | `.hbs` |
| `lit()` | `@dropletsjs/renderer-lit` | `.lit.ts`, `.lit.js` |
| built in | none | `.script.ts`, `.script.js` |

Renderers that share an extension (`.tsx`) tell their components apart by the
packages a component imports. The adapter decides what `vite build` emits:
`@dropletsjs/adapter-node` for `dist/server.js`,
`@dropletsjs/adapter-cloudflare` for a Worker, `@dropletsjs/adapter-bun` and
`@dropletsjs/adapter-deno` for those runtimes. `vite build` without an
adapter fails and says which one to install.

### A droplet

```
src/droplets/<name>/
  +droplet.<ext>       # the component; its flags live here and nowhere else
  +droplet.server.ts   # load, actions, handleError, entries, transform (server only)
  +droplet.ts          # props schema, load, handleError (server and browser)
  +error.<ext>         # the error page, in the same framework
```

```svelte
<!-- src/droplets/hello/+droplet.svelte -->
<script module lang="ts">
  export const hydrate = "visible"; // true | false | "visible" | "interactive"
</script>

<script lang="ts">
  import type { DropletProps } from "./$types";
  let { data, children }: DropletProps = $props(); // data: { who: string }, from the load
</script>

<h1>Hello {data.who}!</h1>
{@render children?.()}
```

```ts
// src/droplets/hello/+droplet.server.ts
import { error } from "$droplets/server";
import type { LoadEvent } from "./$types";

export const load = ({ props }: LoadEvent) => {
  const who = typeof props.who === "string" ? props.who : "world";
  if (who.length > 40) error(404, "Nobody with a name that long lives here.");
  return { who };
};
```

- Flags (`ssr`, `hydrate`, `prerender`) are literal `export const`s of the
  component, parsed before anything is compiled. A flag that is not a literal
  warns and is ignored; flags on `+error.*` warn and are ignored (the error page
  follows the droplet's flags). Defaults: `ssr = true`, `hydrate = true`,
  `prerender = false`.
- The server load's result is inlined into the fragment; hydration needs no
  second request. A load may return promises; a droplet mounted from scratch
  gets `data` as a promise.
- `error()` and `redirect()` answer like an endpoint. Anything else a load
  throws goes through `handleError` to `+error.*`.
- `actions` in `+droplet.server.ts` take form posts; `actionUrl()` from
  `$droplets/form` is where a form posts. Without JavaScript the answer is a
  `303` back to the host page with the result signed in its URL (set
  `DROPLETS_SECRET`, 32+ bytes); `enhanceDropletForm` posts by `fetch`.
- A script droplet (`+droplet.script.ts`) default-exports `(data, el)` and
  runs only in the browser; the server renders nothing for it. `ssr`,
  `hydrate = false` and `hydrate = "interactive"` on it fail the build.

### Embed it

```html
<script type="module" src="https://drops.example.com/index.js"></script>

<!-- the body of GET https://drops.example.com/droplets/hello?who=Ana, pasted in -->
<my-widgets data-droplet="hello">…</my-widgets>
```

| Route | Returns |
| --- | --- |
| `GET`, `POST /droplets/:id` | The fragment; a form body runs an action |
| `GET`, `POST /droplets/:id/_data` | `{ "data": … }`; `PUT`, `PATCH`, `DELETE` answer `405` |
| `GET /droplets/:id/client.js`, `/droplets/:id/style.css` | Bundle and styles |
| `GET /index.js`, `/index.css` | The element loader, shared stylesheet |
| `GET /assets/*` | Built files, cached for good (the adapter serves them) |
| `ALL /api`, `/api/*` | `+server.ts` endpoints |
| `GET /health` | `ok` (the `health` option; before `handle`) |
| `GET /` | The index page when the build has one, else `404` |

A host fetching fragments through an internal address sends the public
location in `x-droplet-location`, with its origin listed in `trustedOrigins`
(or `DROPLETS_TRUSTED_ORIGINS`). Pages on other origins need `cors: true`. Every URL a
droplet emits for its own files is on that droplet location, so a fragment
works under any origin or path prefix the server is reached through. `handle`
in `src/hooks.server.ts` never runs for `/index.js`, `/env.js` and `/assets/*`.

### Also in the box

- `src/hooks.server.ts`: `handle` and `handleError`; `src/hooks.client.ts`:
  `init()`, before any droplet.
- `src/api/**/+server.ts`: endpoints under `/api/`.
- `src/env.ts`: typed environment variables (`defineEnvVars` from
  `@dropletsjs/droplets/env`), read from `$droplets/env/public` and
  `$droplets/env/private`.
- `src/importmap.server.ts`: import maps for libraries kept out of the bundles.
- `$droplets/server`: `json`, `text`, `error`, `redirect`, `fail`,
  `sequence`, `hostFrom`; `$droplets/drop`: the droplets server's location,
  for `fetch(droplet.url("/api/…"))`; `$droplets/form`: `actionUrl` and
  `enhanceDropletForm`.
- `trustedOrigins`, the `Origin` check on form posts, body limits and
  `event.cookies`: see the
  [Security model](https://dropletsjs.dev/guides/security/).
- `@dropletsjs/droplets/postcss`: the PostCSS plugin that scopes the global
  stylesheet to the droplet element (`html`, `body` and `:root` become the
  element).
- `@dropletsjs/droplets/testing`: `rendererConformance()` and
  `fakeRenderer()`, for renderer authors.
- In `vite dev`: hot updates on any page that embeds a droplet, never
  reloading it. With `dev.strategy: "hmr"` (the default) a component edit
  goes through the framework's own HMR (React Fast Refresh, Prefresh, Vue,
  Svelte, solid-refresh), keeping state where that HMR does. Lit and Hono
  JSX remount in place, and a load edit brings new data to the live
  component. A new `ssr`, `hydrate` or `prerender` shows a notice. Also a
  dev tool for host pages (`dev.injectTool`).

### Entries

| Import | File | What |
| --- | --- | --- |
| `@dropletsjs/droplets` | `src/index.ts` | `config`, `resolveConfig`, the types of the config, events, renderer and adapter contracts, `createServerApp` for adapters |
| `@dropletsjs/droplets/vite` | `src/vite.ts` | `droplets()`, the plugin; the flag readers for renderers |
| `@dropletsjs/droplets/server` | `src/runtime/server.ts` | what `$droplets/server` resolves to |
| `@dropletsjs/droplets/env` | `src/env.ts` | `defineEnvVars`, `Register` |
| `@dropletsjs/droplets/postcss` | `src/postcss.ts` | `scopeStylesPlugin`, `scopeSelector` |
| `@dropletsjs/droplets/enhance` | `src/runtime/enhance.ts` | `enhanceDropletForm`, for the renderers' form wrappers |
| `@dropletsjs/droplets/testing` | `src/testing/index.ts` | `rendererConformance`, `fakeRenderer`; imports vitest |
| `@dropletsjs/droplets/ambient` | `ambient.d.ts` | types of `$droplets/*` and the adapters' `virtual:*` modules |
| `djs` | `bin/djs.js` → `src/cli.ts` | `djs sync`, `djs add` |

Other tsdown entries keep a fixed name in `dist/` because code finds them by
path (`src/core/paths.ts`, the plugin's generated modules, the renderers'
`server`/`client` paths): the runtime pieces under `runtime/`, the script
renderer under `script/`, the prerender pass's worker under `vite/`, and the
conformance fixture's adapter entry, the kit's server thread and the fake
renderer under `testing/`.

### Folders

| Folder | What | Runs |
| --- | --- | --- |
| [`src/runtime/`](src/runtime/README.md) | the Hono app and its routes, the SSR entry, the custom element, form tokens, cookies, host | per request or per element; Node-free |
| [`src/vite/`](src/vite/README.md) | the plugin: hooks, virtual modules, dev server, build, CSS, prerender, server-only and one-framework checks | Node, the build |
| [`src/core/`](src/core/README.md) | config, discovery, flags, env, paths, logger | build; `config.ts` and `logger.ts` also at runtime |
| `src/server/` | `createServerApp` (the production app adapters wrap), the manifest shape, prerendered renders | the production server; never a client bundle |
| `src/script/` | the built-in renderer of script droplets | build (`index.ts`), browser (`client.ts`), server (`server.ts`) |
| `src/testing/` | the renderer conformance kit and the fake renderer | tests |
| `src/add/` | `djs add`, shared with `create-droplets` | Node |
| `src/css/` | the PostCSS scoping plugin | build |
| `src/types/` | the type twins of the `$droplets/*` and `virtual:*` modules | types |
| `src/renderer.ts`, `src/adapters.ts` | the renderer and adapter contracts | build |

### Changing this package

- `pnpm --filter @dropletsjs/droplets build` runs tsdown, then the tests
  (`tsdown && vitest run`): the integration tests build fixture projects
  against `dist/`. `build:dist` only compiles. `typecheck` is `tsc -p
  tsconfig.json`.
- While editing, `pnpm dev:lib` (repo root) keeps `dist/` rebuilt for the
  examples; restart an example's Vite server after changing the plugin's
  `config` hook.
- A file something finds by path in `dist/` is a tsdown `entry`, and every
  entry is listed in `graphCheck` as `client` or `server` (`tsdown.config.ts`).
- Tests live in `test/`, mirroring `src/`; `test/integration/` runs a real
  Vite in process, `test/fixtures/` holds the projects, `test/stubs/` the
  stand-ins for the virtual modules.
- New public API (config options, routes, the element contract, the
  renderer contract, `$droplets/*` modules) needs the maintainer's go and a
  change in `apps/docs/`.

### Known limitations

- Flags must be literals.
- In dev, a droplet with `hydrate = false` renders without its component
  styles (they arrive with the client module it never loads); a build has
  them.

## Facts

- Package name `@dropletsjs/droplets`, ESM only (`"type": "module"`). `package.json:2`, `package.json:27`
- Bin `djs` is `bin/djs.js`, a committed launcher that imports `dist/cli.js`, so pnpm links it before `dist/` exists. `package.json:29`, `bin/djs.js:4`
- `djs sync` writes `.droplets/` (every droplet's `./$types` and its tsconfig) without a dev server or a build. `src/cli.ts:15`, `src/cli.ts:29`
- `djs add [name]` writes `src/droplets/<name>/`, asking for what `--framework`, `--target`, `--hydrate`, `--with`, `--pm` leave out; `--yes` asks nothing. `src/cli.ts:18`
- `djs add` loads its prompts only for `add`: `sync` never imports them. `src/cli.ts:66`
- Exports map: `.`, `./vite`, `./server`, `./env`, `./postcss`, `./testing`, `./enhance`, `./ambient` (types only), `./package.json`. `package.json:31`
- Export `./server` is `dist/runtime/server.js`; `./enhance` is `dist/runtime/enhance.js`; `./testing` is `dist/testing/index.js`. `package.json:40`, `package.json:56`, `package.json:52`
- Published files: `bin`, `dist`, `ambient.d.ts`, `README.md`. `package.json:65`
- Engines: Node `>=22`. `package.json:72`
- Dependencies: `@clack/prompts`, `@hono/node-server`, `case-anything`, `hono`, `postcss`, `postcss-selector-parser`. `package.json:83`
- Peer dependencies: `vite` `^8.0.0`; `vitest`, `tailwindcss`, `@tailwindcss/vite` optional. `package.json:91`, `package.json:108`
- Script `build` is `tsdown && vitest run`; `build:dist` is `tsdown`; `dev` is `tsdown --watch`; `typecheck` is `tsc -p tsconfig.json`. `package.json:75`
- tsdown entries: the eight public entries, then the files found by path, then `runtime/dev-element.ts` in its own file so a production build drops it whole. `tsdown.config.ts:6`, `tsdown.config.ts:15`, `tsdown.config.ts:27`
- tsdown entries found by path: `runtime/entry-client`, `entry-server`, `props`, `load`, `env-store`, `request-store`, `form`, `client-init`, `server-records`, `host-tokens`, `vite/prerender-worker`, `script/server`, `script/client`, `testing/conformance-entry`, `testing/conformance-server`, `testing/fake-renderer/server`, `testing/fake-renderer/client`. `tsdown.config.ts:16`
- tsdown bundles no bare import except Oxc's runtime helpers. `tsdown.config.ts:35`
- graphCheck `client` list: `runtime/entry-client`, `props`, `load`, `form`, `enhance`, `client-init`, `server-records`, `dev-element`, `script/client`, `testing/fake-renderer/client`. `tsdown.config.ts:39`
- graphCheck `server` list: `runtime/app`, `entry-server`, `server`, `env-store`, `request-store`, `host-tokens`, `security`, `cookies`, `element`, `index`, `vite`, `cli`, `testing/index`, `testing/conformance`, `testing/conformance-server`, `testing/server-thread`, `testing/composed`, and the folders `vite/`, `core/`, `add/`, `css/`. `tsdown.config.ts:53`
- Runtime CSS is imported with `?inline` through `cssInline()`. `tsdown.config.ts:37`
- tsconfig maps `virtual:droplets*`, `$droplets/env*`, `$droplets/server`, `$droplets/drop`, `$droplets/form` to `src/types/*` (and `src/runtime/server.ts`) for the package's own typecheck. `tsconfig.json:5`
- vitest aliases the virtual modules to `test/stubs/*` and runs `test/**/*.test.ts` in Node with `test/setup.ts`. `vitest.config.ts:8`, `vitest.config.ts:17`
- Portability: `test/portability.test.ts` NEUTRAL list is `runtime`, `server`, `core/config.ts`, `core/logger.ts`. `test/portability.test.ts:14`
- Portability forbids in NEUTRAL files: `node:` imports, `Buffer`, `process.argv/cwd/exit`, an unguarded `process.env`, `__dirname`. `test/portability.test.ts:16`
- Entry `.` exports `config`, `isValidElementName`, `resolveConfig`, `logger`, `setLogLevel`, and the type `DevStrategy`; `DEV_STRATEGIES` stays internal. `src/index.ts:1`, `src/index.ts:2`, `src/index.ts:6`
- Entry `.` exports `DropletsApp`, the type of the Hono app `createServerApp` returns. `src/index.ts:11`
- Entry `.` exports `createServerApp`, `createPrerenderedLoader`, `PRERENDER_DIR`, `setRuntimeEnv`, `FALLBACK_MANIFEST` for adapters. `src/index.ts:85`, `src/index.ts:86`, `src/index.ts:87`, `src/index.ts:47`
- Entry `.` exports the renderer helpers `defineRenderer`, `importsPackage`, `parseHydrateMode`, `RENDERER_QUERY`, `rendererScopeFilter`, `validateRenderers`, `withFlagDefaults`. `src/index.ts:57`
- Entry `.` exports `ActionFailure`, `CookiesInPrerenderError`, `HostUrlPropsErrorInPrerender`, `DropletRenderError`. `src/index.ts:46`, `src/index.ts:12`
- Entry `./vite` exports `droplets()` and `readExportedFlag`, `readExportedFlags`, `readExportedHydrate`. `src/vite.ts:1`, `src/vite.ts:14`
- `droplets()` takes `DropletsPluginOptions` (default `{}`) and returns Vite plugins. `src/vite/plugin.ts:211`
- Entry `./env`: `defineEnvVars` validates and returns the declaration unchanged. `src/env.ts:74`
- Env variable names match `^[A-Za-z_][A-Za-z0-9_]*$`, and each needs an options object; otherwise `validateEnvDeclaration` throws. `src/env.ts:59`, `src/env.ts:62`
- Env `Register` is an `interface` so the user merges `variables` into it. `src/env.ts:40`
- Entry `./postcss` exports `scopeStylesPlugin` and `scopeSelector`. `src/postcss.ts:12`
- `scopeStylesPlugin({ element, include })` nests every selector under `element`; `include` picks the files, all by default. `src/css/scope.ts:4`, `src/css/scope.ts:135`
- `scopeSelector`: `html`, `body`, `:root`, `:host` (and Svelte's `:global(body)`) become the element itself. `src/css/scope.ts:14`, `src/css/scope.ts:69`
- Entry `./testing` exports `rendererConformance` and `fakeRenderer`; it imports vitest, so it is for tests only. `src/testing/index.ts:7`
- `rendererConformance` defaults: `element` `test-droplet`, `interactive` true, `css` true, `adopts` true, `outDir` `<root>/dist-conformance`. `src/testing/conformance.ts:237`
- `rendererConformance` `enhance`: `"wrapper"` (default) or `"attribute"` for template engines. `src/testing/conformance.ts:147`
- `rendererConformance` runs on `fakeRenderer()` and `test/fixtures/app` in this package. `test/conformance.test.ts:7`
- `rendererConformance` serves the fixture from a worker thread (`testing/conformance-server.js`, started by `startServer`), which shares the environment, so `vi.stubEnv` reaches it; a second app there renders as the build's prerender pass does (`building`). `src/testing/server-thread.ts:41`, `src/testing/conformance-server.ts:50`
- `rendererConformance` DOM checks look where a page shows things: `find`/`findAll` of `composed.ts` go into every shadow root, attached or declarative (`<template shadowrootmode>`), and through a `<slot>` to the light children it places; a selector matches one element, never a path across trees. `src/testing/composed.ts:73`, `src/testing/composed.ts:86`
- `rendererConformance` HTML checks ignore comments (`bare`), and read the server markup inert, parsed in a `<template>` (`parse`). `src/testing/conformance.ts:185`, `src/testing/composed.ts:99`
- `rendererConformance` takes the host's children as out of sight when their container is hidden under the element, or sits in a marker a shadow-DOM component leaves unslotted. `src/testing/conformance.ts:901`
- `fakeRenderer()` is named `fake` and handles `.fake.js`. `src/testing/fake-renderer/index.ts:31`
- `createServerApp` throws when the SSR bundle exports neither `renderDroplet` nor a default. `src/server/app.ts:84`
- `cors` allowing every origin warns once under `vite dev` (`devLog`); `createServerApp` warns about nothing. `src/runtime/app.ts:847`, `src/runtime/dev-log.ts:62`
- `createServerApp` mounts `/assets/*` on the adapter's `assetHandler`. `src/server/app.ts:125`
- `AssetLoaders`: every loader returns `null` for something that does not exist. `src/server/app.ts:46`
- `FALLBACK_MANIFEST` is the manifest a runtime answers with before the build is found: no droplets, `__entryClient` `index.js`. `src/server/manifest.ts:42`
- `PRERENDER_DIR` is `_prerendered`: `dist/server/_prerendered/` with a separate SSR bundle, else `dist/client/_prerendered/<random>/` named only in the manifest. `src/server/prerendered.ts:15`, `src/server/prerendered.ts:3`
- `createPrerenderedLoader` reads each droplet's `index.json` once and each render on demand. `src/server/prerendered.ts:57`, `src/server/prerendered.ts:62`
- `createPrerenderedLoader` reads nothing for a droplet name that is not one path segment (`""`, `.`, `..`, `/`, `\`, NUL). `src/server/prerendered.ts:30`
- `createPrerenderedLoader` looks a props key up with `Object.hasOwn`; a malformed file counts as no render. `src/server/prerendered.ts:68`, `src/server/prerendered.ts:44`
- Script droplet renderer is built in, named `script`, for `+droplet.script.ts` and `+droplet.script.js`; core adds it after the user's renderers. `src/renderer.ts:614`, `src/renderer.ts:616`, `src/script/index.ts:81`
- Script droplet is client only: `ssr` false, `hydrate` true, `prerender` false, whatever the file exports. `src/script/index.ts:42`, `src/script/index.ts:64`
- Script droplet flag never fails the build: `hydrate = true` warns `exports hydrate = true; a script droplet is always hydrated (locked to true)`, any other flag `exports <name> = <value>; this is ignored, a script droplet is client only`. `src/script/index.ts:60`, `src/script/index.ts:61`
- Script droplet flag warnings come once per file and flag, across rescans and environments; non-flag exports say nothing. `src/script/index.ts:45`, `src/script/index.ts:55`
- `djs add --framework script` writes no flag and refuses `--target` and `--hydrate`. `src/add/flags.ts:49`, `src/add/add.ts:251`, `src/add/add.ts:252`
- Script droplet server render is `""`: the fragment is the element, its data payload and an empty content root. `src/script/server.ts:9`
- Script droplet `hydrate` is `mount`; `mount` throws when the file has no default function. `src/script/client.ts:46`, `src/script/client.ts:34`
- Renderer flag defaults: `ssr` true, `hydrate` true, `prerender` false. `src/renderer.ts:597`
- Renderer `parseHydrateMode` takes `true`, `false`, `"visible"` or `"interactive"` in either quotes; anything else is `undefined`. `src/renderer.ts:589`
- Renderer extensions core owns, never a renderer's: `.ts`, `.js`, `.server.ts`, `.server.js`, `.d.ts`. `src/renderer.ts:606`
- `validateRenderers` throws for a missing name, a duplicate name, no extensions, an extension without a dot, a core or script suffix, a shared extension where a renderer lists no `packages`, a missing `server`/`client` path. `src/renderer.ts:623`
- `RENDERER_QUERY` is `droplets-renderer`: `…/Button.tsx?droplets-renderer=solid` marks a module for one renderer. `src/renderer.ts:576`
- Adapter contract `DropletsAdapter`: `name`, `serverEntry`, `serverFile`, `separateSsrBundle`, optional `noExternal`, `environment`, `afterBuild`, `preview`. `src/adapters.ts:10`
- `AdapterBuildContext`, what `afterBuild` gets: `root`, `outDir`, `manifestPath`, `serverPath` and the resolved `config`. `src/adapters.ts:47`, `src/adapters.ts:57`
- `vite build` without an adapter throws, naming `@dropletsjs/adapter-node`. `src/vite/build.ts:96`
- Health route answers `ok` and is mounted before `handle`. `src/runtime/app.ts:934`
- `handle` never runs for `/index.js`, `/env.js` and `/assets/*`. `src/runtime/app.ts:356`, `src/runtime/app.ts:982`
- Routes: `/` `src/runtime/app.ts:1107`, `/index.js` `src/runtime/app.ts:1114`, `/index.css` `src/runtime/app.ts:1142`, `style.css` `src/runtime/app.ts:1155`, `client.js` `src/runtime/app.ts:1171`, `_data` `src/runtime/app.ts:1288`, the fragment `src/runtime/app.ts:1676`, `/api` `src/runtime/app.ts:1717`
- `_data` answers `405` with `allow: GET, POST` for `PUT`, `PATCH`, `DELETE`. `src/runtime/app.ts:1284`
- Droplet file URLs (the stylesheet, `client.js`, the `Link` preloads) are built on the request's droplet location. `src/runtime/app.ts:1331`
- `style.css` imports each stylesheet as `../../<file>`, relative to itself. `src/runtime/app.ts:306`
- Dev element code enters production code through one gate: `if (import.meta.env.DEV) installDevElement(...)`. `src/runtime/entry-client.ts:1374`
- Client module dev hooks (`update`, the HMR fallback) are emitted only under `vite dev` or a non-production build. `src/vite/virtual.ts:736`
- Build hash is random per plugin instance, so per build environment; the entry module is named `assets/index.[hash].js`, not after it. `src/vite/state.ts:79`, `src/vite/build.ts:33`
- Dev serves no droplet stylesheets: a `hydrate = false` droplet renders without its component styles in dev. `src/vite/dev.ts:347`
- Flags are read from the droplet's component only; flags `+error.*` declares warn in dev and are ignored. `src/core/discover.ts:171`, `src/core/discover.ts:180`
- Flag not a literal: warns and is ignored. `src/core/flags.ts:127`

# vite

The Vite plugin of `@dropletsjs/droplets`, published as
`@dropletsjs/droplets/vite`. It finds the droplets in `src/droplets/`,
generates the `$droplets/*` modules and the registries, and serves droplets
under `vite dev` with each framework's own HMR. Under `vite build` it emits
the browser bundles, the SSR renderer and the adapter's server; `vite preview`
runs the result.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { node } from "@dropletsjs/adapter-node";
import { svelte } from "@dropletsjs/renderer-svelte";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [svelte()] })],
});
```

## Details

### Options

| Option | What it does |
|---|---|
| `configFile` | Path to `droplets.config.*`, relative to the Vite root. By default the plugin looks up `droplets.config.{ts,mts,js,mjs}`. |
| `adapter` | Decides what `vite build` emits as the server. `vite build` requires one; `vite dev` runs without one; `vite preview` needs one with `preview`. |
| `renderers` | The UI engines. The plugin validates them when `droplets()` is called and appends the built-in `script` renderer. |
| `css` | `path` (the shared stylesheet; default `./src/app.css` when that file exists), `scoped` (default `true`), `tailwind` (default `false`), `twPreflight` (default `true`). |

### The modules

| File | Concern |
|---|---|
| `plugin.ts` | `droplets()`: the core plugin's hooks (`config`, `configureServer`, `hotUpdate`, `generateBundle`, `buildApp`, `configurePreviewServer`), plus `DropletsPluginApi` for companion plugins such as `@dropletsjs/devtools`. |
| `state.ts` | `PluginState`, shared by every plugin of one `droplets()` call. The `config` hook fills it. |
| `virtual.ts` | Every virtual module: the registries (`virtual:droplets`), `$droplets/env`, `$droplets/env/public`, `$droplets/env/private`, `$droplets/server`, `$droplets/drop`, `$droplets/form`, one client module per droplet, the shared CSS, the bundled config, and `/index.js` under `vite dev`. |
| `build.ts` | The `client`, `ssr` and `server` environments, the build order, `droplets.json`, `index.js` and the stylesheet registry. |
| `prerender.ts` | The renders of `prerender = true` droplets for their `entries`, run after the SSR build. |
| `prerender-worker.ts` | The prerender pass's side that evaluates the SSR bundle, in a worker thread; `prerender.ts` drives it. |
| `dev.ts` | The Hono app `vite dev` serves, the SSR module loader, and the classification of an edit (component, load or contract). |
| `assets.ts` | File URLs on the droplet location (`renderBuiltUrl`, `new URL(…, import.meta.url)`), and `public/` at `assets/public/`. |
| `css.ts` | Scoping through PostCSS, Tailwind (`css.tailwind`, `twPreflight`). |
| `server-only.ts` | Keeps server files out of the browser, in the build and in dev. |
| `renderer-graphs.ts` | One framework per droplet, renderer marks for shared extensions, and no CSS from load modules. |
| `sync-types.ts` | `.droplets/`: each droplet's `./$types` and the tsconfig the project extends (`djs sync` writes the same files). |
| `externalize.ts`, `client-external.ts` | The client build's `external` applied under `vite dev` too. |
| `importmap-check.ts` | Dev warnings about the import map. |
| `index-html.ts` | The HTML of `/`. |

### `vite build`

`buildApp` builds `client`, then `ssr` (only when the adapter has
`separateSsrBundle` or a droplet prerenders), then `server`.

- After `client`, the plugin writes `dist/client/droplets.json`,
  `dist/client/index.js` and the droplets' stylesheets, and copies `public/` to
  `dist/client/assets/public/`.
- After `ssr`, the plugin prerenders. It then removes `dist/server/` when the
  adapter does not ship it.
- `adapter.afterBuild` runs last.

Every browser URL a bundle writes for its own files is relative to that
file. The server bundles write their file URLs on `location` of the config
in a build that sets it, else on the location token, which each response
replaces with the request's droplet location.

### `vite dev`

The droplets app runs as middleware after Vite's own. A droplet edit reaches
every page as `droplets:update`, with one of three kinds:

- `component`: Vite's HMR runs, so the framework's own HMR applies.
- `load`: the modules are invalidated and the page gets new data.
- `contract`: `ssr`, `hydrate` or `prerender` changed, and no module update
  is sent.

A new or removed droplet, or a flag change, also sends `droplets:registry`.
An edit to `src/hooks.client.*` sends `droplets:hooks-client` instead of a
Vite update. A change to `droplets.config.ts`, or to anything it imports,
restarts the server.

### Changing this folder

- Run `pnpm dev:lib` while you edit, so `dist/` rebuilds. After a change to
  the `config` hook, restart the example's Vite server: Vite reads that hook
  only when it starts.
- `vite build` resolves `vite.config` again for each environment. Each
  environment gets a fresh `droplets()` with its own `buildHash` and
  `tokenNonce`. Name output files with rolldown's `[hash]`, keep build state
  in plugins marked `sharedDuringBuild`, and check naming with a real
  `vite build` of a project that has a config file (as
  `tests/dev-mixed/test/production.test.ts` does).
- Code generated as strings (`virtual.ts`) calls the runtime entries in
  `dist/runtime/` by path, so their exported signatures are part of the
  contract between this folder and `runtime/`.
- The tests are `test/vite/*` (units) and `test/integration/*`, which run a
  real Vite in process against the built `dist/`.

## Facts

- `droplets()` returns the virtual-modules plugin, the dev externalize plugin, the core `droplets` plugin, asset URLs, Tailwind, server-only, renderer graphs, then each renderer's own plugins, in that order. `plugin.ts:573`
- `droplets()` options are `configFile`, `adapter`, `renderers` and `css`; nothing else is read. `plugin.ts:48`
- `droplets()` appends the built-in script renderer after the user's renderers. `plugin.ts:216`
- `droplets()` validates the renderers when it is called: two renderers claiming one extension without `packages` to tell them apart is an error. `plugin.ts:220`, `../renderer.ts:623`
- `config` hook loads `droplets.config.*`, the env state, discovers the droplets and writes `.droplets/`, in every `vite dev` and `vite build`. `plugin.ts:320`, `plugin.ts:325`, `plugin.ts:335`, `plugin.ts:340`
- `config` hook: a `static` env variable without a value throws under `vite build` and only warns under `vite dev`. `plugin.ts:331`
- `config` hook sets `appType: "custom"`. `plugin.ts:349`
- `config` hook sets `server.fs.allow` to the workspace root, the package root and the renderers' module folders. `plugin.ts:356`
- `config` hook sets `server.port` from `dev.server.port` only when Vite's own `server.port` is unset. `plugin.ts:357`
- `server.origin` under `vite dev` is set to `http://localhost:<port>` unless the user set `server.origin` or `middlewareMode`, so asset URLs are absolute to the dev server. `plugin.ts:360`
- `server.origin` is corrected to the real port once the dev server listens on another one. `plugin.ts:393`
- `optimizeDeps.exclude` gets the plain package names of the client build's `external`. `plugin.ts:364`
- `config` hook under `vite build` requires an adapter, sets `experimental.renderBuiltUrl` and the `client`, `ssr` and `server` environments. `plugin.ts:368`, `plugin.ts:369`, `plugin.ts:376`
- `vite build` with no droplet found warns `no droplets found` and builds. `plugin.ts:371`
- `vite dev` ssr environment bundles `SERVER_NO_EXTERNAL` (`resolve.noExternal`). `plugin.ts:379`
- `vite dev` sets the runtime env store from the `.env` values. `plugin.ts:403`
- `vite dev` middleware is added after Vite's own and registered before the first scan; an early request waits for it. `plugin.ts:422`
- `droplets.config.ts` change (or a file it imports) restarts the dev server. `plugin.ts:408`, `plugin.ts:429`
- `hotUpdate`: a `hooks.server.*` file or a route under the API folder that appears or goes away invalidates the registry. `plugin.ts:438`
- `hotUpdate`: an edit to `src/hooks.client.*` sends `droplets:hooks-client` and no Vite update. `plugin.ts:446`, `plugin.ts:451`
- `hotUpdate` plans an edit once per timestamp, in the first environment, and forgets plans older than 10 seconds. `plugin.ts:457`, `plugin.ts:462`
- `hotUpdate`: an edit in a droplet folder rescans the flags; a changed registry sends `droplets:registry`. `plugin.ts:236`, `plugin.ts:243`
- `droplets:update` goes to every affected droplet with `kind` `contract`, `component` or `load`. `plugin.ts:273`, `plugin.ts:279`
- `droplets:update` takes `hydrate` from the discovered entry; `hotUpdate` never evaluates the SSR module, which would transform the edited component before its framework's HMR hook runs, from a file possibly still empty mid-save. `plugin.ts:276`
- `hotUpdate`: a contract change or a load edit invalidates the modules and hands Vite only the stylesheets that depend on the file. `plugin.ts:481`
- `hotUpdate`: a component edit goes through Vite's own HMR, so the framework's runs. `plugin.ts:491`
- `generateBundle` of the client build records every bare import left external, for `importmap`'s `externals`. `plugin.ts:495`
- `buildApp` writes the manifest and copies `public/` right after the client build. `plugin.ts:524`, `plugin.ts:525`
- `buildApp` prerenders right after the ssr build, then removes `dist/server/` unless the adapter has `separateSsrBundle`. `plugin.ts:529`, `plugin.ts:533`
- `adapter.afterBuild` runs last, with `root`, `outDir`, `manifestPath`, `serverPath` and the resolved `config`. `plugin.ts:539`, `plugin.ts:544`, `../../test/integration/vite.test.ts:241`
- `vite preview` runs `adapter.preview`; without it the plugin warns and serves nothing. `plugin.ts:552`
- `DropletsPluginApi` (`plugin.api`) gives `element`, `strategy`, `droplets`, `renderers`, `dropletsRoot`, `importMapPath`, `fetch`, `loaderUrl`, `syncTypes` and `setDevTool`. `plugin.ts:105`, `plugin.ts:294`
- `DropletsPluginApi.renderers()` never lists the built-in `script` renderer. `plugin.ts:298`
- `DropletsPluginApi.fetch` throws outside `vite dev`. `plugin.ts:302`
- `DropletsPluginApi.loaderUrl` is `/index.js`. `plugin.ts:306`
- Build environments are `client`, `ssr` and `server`, built in that order. `build.ts:93`
- Build environment `ssr` builds only when the adapter has `separateSsrBundle` or a droplet has `prerender`. `build.ts:111`
- `vite build` without an adapter throws, naming `node()` from `@dropletsjs/adapter-node`. `build.ts:98`
- `vite build` with `index` naming a file that does not exist throws in the `config` hook, before anything is built. `plugin.ts:373`, `index-html.ts:40`
- `buildApp` empties `<outDir>` before the first environment builds, by Vite's `build.emptyOutDir` rule (always when `true`, never when `false`, else only inside the project), `.git` kept; an outDir outside the project warns and stays. `build.ts:102`, `plugin.ts:524`
- `vite build` must run through the builder (`vite build`, `createBuilder().buildApp()`): Vite's plain `build()` never calls `buildApp`, and the first `buildStart` throws `vite build (the builder) is required`. `plugin.ts:397`
- Build `client` writes to `<outDir>/client` and empties it; `ssr` writes to `<outDir>/server` and empties it; `server` writes to `<outDir>` with `emptyOutDir: false`. `build.ts:138`, `build.ts:162`, `build.ts:126`
- Build environments all set `copyPublicDir: false`. `build.ts:128`, `build.ts:141`, `build.ts:164`
- Build `client` writes Vite's manifest and keeps entry signatures (`exports-only`). `build.ts:142`, `build.ts:144`
- Build `client` inputs: `entry-client`, `droplets-css` and one `droplets/<id>` per droplet. `build.ts:81`
- Build file names: the entry module is `assets/index.[hash].js` (named by content, not by the build hash); a droplet bundle is `droplets/<id>/client.js`; chunks are `assets/chunks/[name]-[hash].js`; assets `assets/[name]-[hash][extname]`. `build.ts:34`, `build.ts:149`, `build.ts:150`, `build.ts:151`
- `SERVER_NO_EXTERNAL`: `hono`, `hono/*`, `case-anything`, `@dropletsjs/droplets(/*)` and `@dropletsjs/renderer-*` are always bundled into server bundles. `build.ts:61`
- Adapter `noExternal: true` bundles everything; a list is added to `SERVER_NO_EXTERNAL`. `build.ts:121`
- Adapter `environment` options are merged over the server environment and win. `build.ts:173`
- `droplets.json` is written to `dist/client/droplets.json`. `build.ts:333`
- `droplets.json` lists, per droplet, `client` only when it ships a client and `css` only when it has stylesheets. `build.ts:242`, `build.ts:243`
- `droplets.json` css: the shared stylesheet comes first, only when it is not empty, then the stylesheets of the chunks the droplet imports (depth first), then its own, each once. `build.ts:238`, `build.ts:184`, `build.ts:311`
- `hydrate = false` droplet goes through the client build for its CSS; its `droplets/<id>/` folder is removed afterwards. `build.ts:315`
- `dist/client/index.js` is `import "./env.js"` (only when `src/env.ts` declares public variables read at runtime), a static `import` of `./assets/index.<hash>.js`, then the location record from its own URL. `build.ts:266`, `build.ts:338`
- `dist/client/index.js` imports statically, so the browser fetches `env.js` and the entry at once and evaluates `env.js` first; the location record runs after the entry. `build.ts:266`, `../../test/integration/index-js.test.ts`
- Before the location record runs, the element reads the same location from the entry's own URL (`serverLocation`). `../runtime/server-records.ts:48`, `../../test/integration/index-js.test.ts`
- `dist/client/index.css` is `@import url("./assets/<hash>.css");`, written only when the shared stylesheet is not empty; `droplets.json` names it `__globalStyle`, `/index.css` serves it `no-store`, and the stylesheet itself stays under `/assets/`. `build.ts:24`, `build.ts:264`, `build.ts:340`, `../server/manifest.ts:22`
- Stylesheet registry: the droplets' stylesheets are written into the entry module after the client build; no room for them throws. `build.ts:322`, `build.ts:284`
- Vite manifest missing: `writeManifest` warns and falls back to default CSS paths. `build.ts:296`
- `renderBuiltUrl`: the user's own `experimental.renderBuiltUrl` answers first. `assets.ts:50`
- `renderBuiltUrl` server bundles: a file URL is `__DROPLETS_SERVER_LOCATION__/<file>` until the chunk renders, then the shared instance's `bundleLocation`. `assets.ts:53`, `assets.ts:167`
- `renderBuiltUrl` browser JavaScript: `new URL("<relative>", import.meta.url).href`, relative to the file that names it. `assets.ts:59`
- `renderBuiltUrl` browser CSS: a relative path from the stylesheet. `assets.ts:60`
- `renderBuiltUrl` asset naming an asset: `{ relative: true }`. `assets.ts:54`
- `renderBuiltUrl` public file: named as `assets/public/<file>`. `assets.ts:52`
- `__DROPLETS_BUILD_ROOT__` in a browser bundle becomes the way back to the build's root (`../../` from `droplets/<id>/client.js`); under `vite dev` it becomes `/`. `assets.ts:170`, `assets.ts:152`
- `new URL("./x", import.meta.url)` of an existing file, in a universal project file of a server bundle, becomes a `?url` import on `bundleLocation`; server files keep theirs. `assets.ts:154`, `assets.ts:156`, `assets.ts:84`
- `public/` is copied to `dist/client/assets/public/` and nowhere else. `assets.ts:100`
- `public/` under `vite dev` is served at `/assets/public/*` with `cache-control: no-cache` and a sha1 `ETag`, 304 when it matches. `assets.ts:124`, `assets.ts:132`, `dev.ts:430`
- `public/` under `vite dev`: a path outside it, a folder or a missing file answers `404 Not Found`. `assets.ts:114`, `assets.ts:117`
- `assetUrlsPlugin` is `sharedDuringBuild`: one location token nonce for every environment of a build. `assets.ts:144`
- `buildHash` is 6 random hex characters, created per `droplets()` instance. `state.ts:79`, `state.ts:86`
- `tokenNonce` is created per `droplets()` instance; each server bundle exports its own, `undefined` when the build fixes `location` and `host`. `state.ts:87`, `virtual.ts:268`, `virtual.ts:790`
- Server bundles write `location` of the config in a build, else the instance's location token; `vite dev` always writes the token. `state.ts:177`
- The prerender app takes `location` of the config: its renders hold it, not a token. `prerender.ts:112`
- Prerender host fallback: the app gets `host` of the config, and an entry without `host` renders for it; else none (host-agnostic renders). `prerender.ts:114`, `prerender.ts:121`
- `vite dev` ignores `host` of the config: an entry without `host` is host-agnostic there. `dev.ts:396`, `../runtime/entry-server.ts:266`
- `hooks.server` files looked up: `src/hooks.server.ts`, `src/hooks.server.js` (`MODULE_EXTENSIONS`). `state.ts:159`
- `warnMisnamedModules`, from the `config` hook, warns once about a `src/hooks.server` or `src/importmap.server` spelled `.mts`, `.mjs`, `.cts` or `.cjs`: `is not loaded; name it src/hooks.server.ts or src/hooks.server.js`. `state.ts:175`, `plugin.ts:349`
- `hooks.client` files looked up: `src/hooks.client.ts`, `.mts`, `.js`, `.mjs`. `state.ts:164`
- `importmap.server` files looked up: `src/importmap.server.ts`, `src/importmap.server.js`. `state.ts:166`
- Virtual ids: `virtual:droplets`, `virtual:droplets-dev`, `virtual:droplet-client?name=<folder>`, `virtual:droplets-css`, `virtual:droplets-config`, `virtual:droplets-ssr`, `virtual:droplets-manifest`. `virtual.ts:31`, `virtual.ts:33`, `virtual.ts:65`, `virtual.ts:67`, `virtual.ts:69`, `virtual.ts:71`, `virtual.ts:73`
- `$droplets/*` modules: `$droplets/env`, `$droplets/env/public`, `$droplets/env/private`, `$droplets/server`, `$droplets/drop`, `$droplets/form`. `virtual.ts:35`, `virtual.ts:37`, `virtual.ts:39`, `virtual.ts:41`, `virtual.ts:43`, `virtual.ts:45`
- `$droplets/server` and `$droplets/env/private` are refused in the client environment and to any project file that is not a server file, on the server too. `virtual.ts:48`, `virtual.ts:744`
- `$droplets/server` refusal message: `can only be imported by server files`, naming the importer. `virtual.ts:748`
- `$droplets/server` resolves to `dist/runtime/server.js`. `virtual.ts:753`
- `@dropletsjs/droplets/server`, the bare package entry, is refused where `$droplets/server` is, by `server-only.ts` ahead of Vite's resolver (a `pre` plugin), in build and dev; `virtual.ts` keeps the two `$droplets/*` ids. `server-only.ts:84`, `server-only.ts:241`
- `virtual:droplets-ssr` resolves to `dist/runtime/entry-server.js`, and `virtual:droplets-manifest` to `<outDir>/client/droplets.json`. `virtual.ts:762`, `virtual.ts:763`
- `/index.js` under `vite dev` is a virtual module: the location record, the public runtime variables, then a dynamic import of the entry client. `virtual.ts:764`, `virtual.ts:868`
- The dev app's `/index.js` is the location record, the public runtime variables, then the transformed entry client. `dev.ts:324`, `dev.ts:329`
- `virtual:droplets` is the client registry in client environments and the server registry in server environments. `virtual.ts:772`
- Client registry exports `buildHash`, `elementName`, `dropletsById`, `dropletsHydrateById`, `dropletsServerLoadById`, `dropletsScriptById` and `dropletsStylesById`. `virtual.ts:485`
- Client registry under `vite dev` imports the shared CSS; a build fills `dropletsStylesById` from the placeholder instead. `virtual.ts:482`, `virtual.ts:502`
- Client registry with `src/hooks.client.*` imports it and calls `runClientInit`, never awaited. `virtual.ts:504`, `virtual.ts:445`
- Server registry imports every component, error page, `+droplet.ts` and `+droplet.server.ts` statically, with the loads wrapped in thunks. `virtual.ts:231`, `virtual.ts:248`
- Server registry: a script droplet's component is `Object.freeze({})`; the file is never imported on the server. `virtual.ts:229`
- Server registry takes `ssr`, `hydrate` and `prerender` from the discovered entry. `virtual.ts:245`
- Load files: the registry and the client module import `loadFile` and `serverLoadFile` of the entry (`+droplet.ts` or `.js`, `+droplet.server.ts` or `.js`), as discovery named them. `virtual.ts:234`, `virtual.ts:237`, `virtual.ts:566`
- `$droplets/env` exports `browser`, `dev` and `building` (SSR and `Symbol.for("droplets.building")` set). `virtual.ts:804`, `virtual.ts:807`
- `$droplets/drop` in the browser: `origin` is `serverLocation()` for this element and build, read on every call. `virtual.ts:295`
- `serverLocation()` falls back to the root of the build the bundle belongs to when `/index.js` recorded nothing. `../runtime/server-records.ts:49`
- `$droplets/drop` on the server: `origin` is the request's public location, else the bundle's location token. `virtual.ts:332`
- `$droplets/drop` on the server of a build with `location`: `origin` is `location`, with no token and no request store. `virtual.ts:317`, `virtual.ts:827`
- `$droplets/drop` `url(path)`: an absolute URL stays as it is, a path starting with the token gets the request's location, anything else is joined to `origin` with one slash. `virtual.ts:281`, `virtual.ts:338`
- `$droplets/form` exports `actionUrl` (default too) and `enhanceDropletForm`. `virtual.ts:360`, `virtual.ts:368`
- `$droplets/form` `actionUrl()` outside a render without `{ droplet }` throws. `virtual.ts:364`
- Client module dev parts (`update`, the HMR fallback) are emitted when the command is `serve` or the build is not production (`import.meta.env.DEV`). `virtual.ts:736`, `virtual.ts:880`
- Client module `update` export exists only with dev parts on and a renderer that has `clientDev`. `virtual.ts:573`, `virtual.ts:661`
- Client module HMR fallback accepts the component and error page and dispatches `droplets:hot-fallback`. `virtual.ts:674`, `virtual.ts:675`
- Client module imports the renderer's `clientSetup` first, for its side effects. `virtual.ts:575`
- Client module hydrates when the target has child nodes, mounts otherwise. `virtual.ts:624`, `virtual.ts:642`
- `virtual:droplets-dev` exports `strategy`, `injectTool` and `toolUrl`. `virtual.ts:424`
- `virtual:droplets-config` is the default export of `droplets.config.ts`, or `{}`; a function is called in the bundle with the `{ command, mode, … }` the plugin's `config` hook received, as a literal, so the adapter awaits what it returns. `virtual.ts:701`, `virtual.ts:707`, `virtual.ts:737`
- `virtual:droplets-config` exports `tokens`: the replacers of `dist/runtime/host-tokens.js`, or `undefined` when `vite build` has both `location` and `host`. `virtual.ts:692`, `virtual.ts:856`, `state.ts:186`
- Shared CSS module imports `css.path`; without one, Tailwind's full import when scoped with preflight, theme and utilities otherwise, nothing without Tailwind. `virtual.ts:842`, `virtual.ts:849`, `virtual.ts:850`
- Droplet discovery in virtual modules: cached once under `vite build`, rescanned on each load under `vite dev`. `virtual.ts:717`
- Server file: a project file named `*.server.*`, a `+server.*` route, or one with a folder named `server` on its path. `server-only.ts:17`, `server-only.ts:36`
- Server file names and folders match in any case: `Server/`, `SERVER/`, `db.SERVER.ts` and `+Server.ts` are server files. `server-only.ts:17`, `server-only.ts:36`
- Server file check skips virtual ids, files outside the root, `node_modules` and the framework's own `dist/` and `src/`. `server-only.ts:47`, `server-only.ts:50`, `server-only.ts:51`, `server-only.ts:52`
- Server file under `vite build`: the client environment's `buildEnd` walks the graph from the entries and fails on the first server file, naming the chain. `server-only.ts:170`, `server-only.ts:92`
- Server file under `vite dev`: `resolveId` in the client environment refuses an import that resolves to one, naming the importer chain. `server-only.ts:157`, `server-only.ts:166`
- Server file reached as a file under `vite build` (`new URL(…, import.meta.url)`, a CSS `url()`, `?url`, `?raw`): the client environment's `assetsInlineLimit` is wrapped to record and refuse one before Vite inlines it, `buildEnd` fails on what was recorded, and `generateBundle` fails on an emitted asset whose `originalFileNames` name one. `server-only.ts:160`, `server-only.ts:232`, `server-only.ts:238`
- Server file asked for directly under `vite dev` (`GET /src/lib/server/x.txt`, any query, `/@fs/` included): a middleware ahead of Vite's file server answers 403 with the error message. `server-only.ts:203`
- Server file error message: `<file> is server code and cannot reach the browser: <chain>`; for a file reference the chain reads `referenced as a file (new URL(…, import.meta.url), ?url, ?raw or a CSS url())`. `server-only.ts:75`, `server-only.ts:79`
- Server file error chain: project files from the root without their query, a virtual id without its `\0` prefix and with its query (`virtual:droplet-client?name=card`). `server-only.ts:67`
- Renderer ownership: a module belongs to a renderer by its `extensions`, its `suffixes`, or a file inside one of its `packages`. `renderer-graphs.ts:65`
- Renderer ownership: a subpath package (`hono/jsx`) owns that folder at any depth of the package. `renderer-graphs.ts:83`
- Cross-framework check skips script droplets, and the script renderer owns nothing. `renderer-graphs.ts:128`, `renderer-graphs.ts:138`
- Cross-framework check under `vite build` runs in every environment's `buildEnd`, from each component and error page. `renderer-graphs.ts:368`, `renderer-graphs.ts:233`
- Cross-framework check under `vite dev` runs per import as it resolves, for every droplet that reaches the importer; importers under `node_modules` are not checked. `renderer-graphs.ts:337`, `renderer-graphs.ts:318`
- Cross-framework error message: `a <renderer> droplet imports <owner> code: <chain>`. `renderer-graphs.ts:165`
- Load CSS check: a stylesheet reached from `+droplet.ts` or `+droplet.server.ts` fails the build and the dev import. `renderer-graphs.ts:250`, `renderer-graphs.ts:321`
- `isStylesheet` takes `.css .less .sass .scss .styl .stylus .pcss .postcss .sss`; a `?url`, `?raw` or `?inline` import is a string, not a stylesheet, and so is the `?transform-only` module a build turns `?url` into. `renderer-graphs.ts:39`, `renderer-graphs.ts:41`
- Renderer marks: with two renderers sharing an extension, modules a droplet reaches get `?droplets-renderer=<name>`, spread to script modules outside `node_modules` and outside the renderers' packages. `renderer-graphs.ts:361`, `renderer-graphs.ts:364`
- Flags come from `discoverDroplets`, read from the droplet's component only. `../core/discover.ts:171`, `../core/discover.ts:251`
- Flags an error page declares are ignored (a warning in build and dev); the error page follows the droplet. `../core/discover.ts:181`
- Script droplet flags are ignored with a warning, once per file and flag: it is always `ssr` false, `hydrate` true, `prerender` false. `../script/index.ts:51`, `../script/index.ts:64`
- `classifyChange`: in a droplet folder, `+droplet.ts` is a universal load edit, `+droplet.server.ts` or a server file a load edit, anything else a component edit. `dev.ts:185`, `dev.ts:190`, `dev.ts:193`
- `classifyChange`: a file outside the droplet folders is traced up the module graphs to the components and loads that import it. `dev.ts:198`
- Dev SSR module is loaded through the ssr environment's runner (else `ssrLoadModule`), outside any request's info. `dev.ts:252`, `dev.ts:255`
- Dev droplet rescan that fails (two components, an unknown extension) logs the error and keeps the previous list. `dev.ts:267`
- Dev droplet rescan writes `.droplets/` again. `dev.ts:271`
- `dist/client/droplets/<id>/style.css` holds what `/droplets/<id>/style.css` answers (`styleImports`), written after the JavaScript of a droplet that does not hydrate is removed; a droplet without stylesheets has none. `build.ts:326`, `build.ts:327`
- Dev app: droplets have no stylesheets of their own; `style.css` answers 404 and fragments link none. `dev.ts:348`
- Dev app: `/index.css` answers 404 without a shared stylesheet (`css.path` false or missing). `dev.ts:335`
- Build: an empty shared stylesheet is removed from `dist/client/assets/`, and the 0-byte `droplets-css.js` chunk of its entry is never kept. `build.ts:313`, `build.ts:316`
- Dev app sends no `Link` header. `dev.ts:419`
- Dev app re-reads `handle`, `+server.ts` routes and `handleError` from the SSR module per request. `dev.ts:375`, `dev.ts:376`, `dev.ts:378`
- Dev app renders listed `entries` props live; nothing is prerendered. `dev.ts:393`
- Dev app passes the request's props to `renderError`, for a live render and for a listed entry that failed, as the production app does. `dev.ts:378`, `dev.ts:401`
- Dev `handleError`: a form action's data that cannot travel as JSON answers with its message. `dev.ts:39`
- Dev import map: each bare key gets a `/@id/<name>` alias too. `dev.ts:368`, `externalize.ts:28`
- Dev import map warnings print once each, unless `warnImportMap: false`. `dev.ts:362`, `dev.ts:364`
- Import map check warns for an external the map does not map, a mapped name that is not external, and a version in the URL that differs from the installed one. `importmap-check.ts:53`, `importmap-check.ts:59`, `importmap-check.ts:66`
- Client externals come from top-level `build.rolldownOptions.external` (or `rollupOptions`) and `environments.client.build`. `client-external.ts:18`, `client-external.ts:29`
- Dev externalize plugin runs under `vite dev` only and keeps external only imports reached from a droplet's client module. `externalize.ts:57`, `externalize.ts:65`
- `css.path` default is `./src/app.css` when it exists; `false` turns it off. `css.ts:55`, `css.ts:62`
- `css` defaults: `scoped` true, `tailwind` false, `twPreflight` true. `css.ts:67`, `css.ts:68`, `css.ts:69`
- `css.scoped` adds the scoping PostCSS plugin after the user's own: an inline `css.postcss`'s plugins, else the project's PostCSS config file's, loaded with `postcss-load-config` as Vite loads it (from `css.postcss` when that is a directory, else the root, up to the workspace root), its options kept. `css.ts:171`, `css.ts:198`
- `css.postcss` config file that fails to load throws `the PostCSS config <file> failed to load`, naming the file postcss-load-config would read. `css.ts:177`
- `css.tailwind` adds `@tailwindcss/vite` unless a plugin named `@tailwindcss/vite*` is already there; without Tailwind installed it throws. `css.ts:222`, `css.ts:223`, `css.ts:225`
- `css.twPreflight: false` rewrites `@import "tailwindcss"` to theme and utilities and drops the preflight import; a preflight that still shows up warns. `css.ts:89`, `css.ts:147`
- Prerender requests go to `http://droplets.build/droplets/<id>` as a POST of `{ props, host? }`, through `handle`, with `building` set. `prerender.ts:33`, `prerender.ts:123`, `prerender.ts:87`
- Prerender evaluates the SSR bundle in a worker thread (`prerender-worker.ts`, `dist/vite/prerender-worker.js` by path), started with `connect` of `core/app-thread.ts` and stopped when the pass ends; `entries` and `request` are the calls. `prerender.ts:93`, `prerender.ts:98`, `prerender.ts:144`
- Prerender worker sets `building` and the runtime env store from the mode's `.env` values before the bundle loads. `prerender-worker.ts:31`, `prerender-worker.ts:32`, `prerender-worker.ts:33`
- Prerender root: `dist/server/_prerendered` when the adapter ships `dist/server`, else `dist/client/_prerendered/<32 hex>` with that name written into `droplets.json` as `__prerendered`. `prerender.ts:53`, `prerender.ts:54`, `prerender.ts:83`
- Prerender removes the previous build's renders first. `prerender.ts:73`, `prerender.ts:74`
- Prerender file: `<id>/<16 hex of sha256(key)>.json`, listed in `<id>/index.json`. `prerender.ts:42`, `prerender.ts:161`
- Prerender: a render that read `host` without one stops the build. `prerender.ts:128`
- Prerender: a non-2xx answer warns `not stored, it renders live`. `prerender.ts:138`
- Prerender: a failed load is stored with `failed: true` and `error`, without headers. `prerender.ts:155`
- `.droplets/` holds one `$types.d.ts` per droplet at `.droplets/types/<droplet folder from the root>/`. `sync-types.ts:8`, `sync-types.ts:221`
- `.droplets/tsconfig.json`: `module: "esnext"`, `moduleResolution: "bundler"`, `rootDirs` of the root and `.droplets/types`; `include` and `files` only for a `x.tsx` next to `x.ts`. `sync-types.ts:127`, `sync-types.ts:131`
- `.droplets/` files are written only when their content changed; a stale `$types.d.ts` is removed with every folder it leaves empty, up to `.droplets/types`. `sync-types.ts:186`, `sync-types.ts:238`
- `.droplets/` write failure only warns. `sync-types.ts:252`
- `.droplets/tsconfig.json` is written before the config loads when it is missing. `sync-types.ts:161`
- `./$types` component types come from the renderer's `componentTypes`, else `@dropletsjs/droplets`. `sync-types.ts:46`
- `index` page: `false` is no page, a string path that does not exist throws, else `index.html` in the root, else a placeholder. `index-html.ts:36`, `index-html.ts:40`, `index-html.ts:44`
- `vite/` runs on Node (build tooling); client entries never reach it (`graphCheck` lists it on the server side). `../../tsdown.config.ts:66`

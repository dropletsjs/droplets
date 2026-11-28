# @dropletsjs/adapter-cloudflare

The Cloudflare Workers adapter for [Droplets](../../droplets). With it,
`vite build` writes `dist/worker.js`: one self-contained Worker with the SSR
renderer, your config and the manifest inlined. The client build in
`dist/client` is served through Workers Static Assets, with the headers of
the `dist/client/_headers` the build writes.

```bash
pnpm add -D @dropletsjs/adapter-cloudflare wrangler
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { cloudflare } from "@dropletsjs/adapter-cloudflare";

export default defineConfig({
  plugins: [droplets({ adapter: cloudflare(), renderers: [svelte()] })],
});
```

```jsonc
// wrangler.jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-droplets",
  "main": "dist/worker.js",
  "compatibility_date": "2025-10-01",
  // AsyncLocalStorage, which keeps overlapping requests apart.
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "dist/client",
    "binding": "ASSETS"
  }
}
```

```bash
vite build
wrangler dev        # local, in workerd
wrangler deploy
```

## Details

### Options

`cloudflare({ assetsBinding })` names the Workers Static Assets binding, as
`assets.binding` declares it in the wrangler config. Default: `ASSETS`. The
name is fixed in `dist/worker.js` at build time.

### What `vite build` writes

| Path | What it is |
|---|---|
| `dist/worker.js` | the Worker: this package's `worker.ts` with Hono, the framework, your droplets, hooks, `+server.ts` routes, `droplets.config.ts` and the manifest bundled in; no `import` is left, so no `node_modules` at runtime |
| `dist/client/` | the browser build, uploaded as static assets |
| `dist/client/droplets/<id>/style.css` | the droplet's `style.css`, a file the assets serve as they are; none for a droplet without stylesheets |
| `dist/client/assets/public/` | a copy of your `public/` folder, served at `/assets/public/` |
| `dist/client/_prerendered/<random>/` | prerendered renders, in a folder named anew every build; only the inlined manifest holds the name |
| `dist/client/.assetsignore` | `/droplets.json` and `/.vite/`: wrangler never uploads them |
| `dist/client/_headers` | the CORS and `Cache-Control` of the build's files, then your own `_headers` from the project root |

There is no `dist/server.js` and no `dist/server/` folder.

### `_headers`

Static assets answer every file in `dist/client` before the Worker runs, so
the build's files never cost a Worker invocation. `dist/client/_headers`
gives them their headers, written from the file-header table the plugin
passes to `afterBuild` (`fileHeaders`, built from the config), the
same table the Worker sets on the files it answers itself:

- `/index.js` and `/index.css`: `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`.
- `/assets/*`, `/droplets/:id/client.js`, `/droplets/:id/style.css`:
  `Access-Control-Allow-Origin: *`, `Cache-Control: public,
  max-age=2592000, immutable`.
- `/assets/public/*`: `Cache-Control` from `publicCacheControl`
  (`no-cache` by default); with `false`, none.
- `/assets/prerendered/*`, the prerender files: `Cache-Control` from
  `fragmentCacheControl` with `no-transform`, as the live fragment
  (`private, no-store, no-transform` by default).
- Every rule but `/assets/public/*` and `/assets/prerendered/*` (which get
  it from `/assets/*`) adds `X-Content-Type-Options: nosniff`.

The table gives a path the headers of its last matching rule alone, while
Cloudflare applies every rule that matches and joins a header two rules set
with a comma. So each rule writes only what differs from the wider rule
before it, and detaches (`! Name`) what it replaces or leaves out; a rule
with no wider one before it detaches `Cache-Control` first, which static
assets send on their own. Your own `_headers`, in the project root, is
appended after these rules. A `public/_headers`
lands at `/assets/public/_headers`, where Cloudflare never reads it: the
build warns once. It also warns over Cloudflare's limits, 100 rules and
2,000 characters a line. `_headers` is never served as a file, so
`.assetsignore` does not list it.

### The wrangler config

After the build, the adapter reads `assets.run_worker_first` from the first
of `wrangler.jsonc`, `wrangler.json` or `wrangler.toml` in the project root.
It never writes the file and never fails the build:

- Unset, `false`, or a list that matches none of the build's files passes
  in silence.
- `true`, or a list that matches `/index.js`, `/index.css`, `/assets/*` (the entry,
  chunks, `public/`) or a droplet's `client.js` or `style.css` (a `!`
  pattern that excludes a path wins), warns once: those files would go through the Worker, billed
  per request, and `_headers` already gives them their headers.
- A config it cannot parse warns that it could not read the value.
- No config at all logs what to set: `main`, `assets.directory` and
  `assets.binding`.

`nodejs_compat` gives the Worker `AsyncLocalStorage`. Without it, requests
that overlap share one request store: the last one to start wins. A wrangler
config whose `compatibility_flags` has no `nodejs_compat` (or the older
`nodejs_compat_v2`) makes the build warn once, never fail.

### Static files

When a request for a file reaches the Worker (a file that is missing, or a
`run_worker_first` that sends it), `/assets/*` is fetched from the assets
binding and never passes through `handle` from your hooks.

- A file the binding does not have answers `404 Not Found`, text and
  `cache-control: no-store`, as on Node; any other binding answer of 400 or
  more passes through with `cache-control: no-store`.
- A successful answer gets the headers of the file-header table, as on
  Node: every file Vite emits there is content-hashed, `cache-control:
  public, max-age=2592000, immutable`.
- `/assets/public/*` keeps its names, so it is revalidated:
  `cache-control: no-cache` (`publicCacheControl`) with the binding's own `ETag` and `304`; when the
  binding sends no `ETag`, one is made from the SHA-1 of the content and
  `If-None-Match` is answered with `304`.
- `/assets/prerendered/*` is revalidated the same way, with the live
  fragment's `cache-control`; never `immutable`.
- Nothing else in `dist/client` is a Worker route: `/robots.txt` answers 404.

The Worker reads droplet bundles, `/index.js` and the global CSS through
the binding when it answers them; the manifest itself is in the bundle.

### Environment

The bindings (vars and secrets) are the runtime environment: each request
sets them as the source of `$droplets/env` private variables,
`DROPLETS_SECRET`, `DROPLETS_TRUSTED_ORIGINS` and `DROPLETS_ENV_MAX_AGE`, and
`platform.env` in server code holds all of them. `.env` files are a build
input only. The first deploy creates the Worker and carries the secret:
`wrangler deploy --secrets-file <file>`, a temporary JSON file
`{"DROPLETS_SECRET": "…"}` holding `openssl rand -base64 48` (at least 32
bytes); a `wrangler secret put` before the Worker exists creates an empty
Worker of that name. Later rotations are `wrangler secret put DROPLETS_SECRET`.
`PORT` and `server.port` do not apply: the platform decides the address. Set
`cors` in the config if pages on other origins fetch fragments or data; the
build's files carry `Access-Control-Allow-Origin: *` without it. See
[Deployment](https://dropletsjs.dev/guides/deployment/).

### Changing this package

`pnpm --filter @dropletsjs/adapter-cloudflare build` runs the tests, then
tsdown. The tests build the framework's own fixture
(`packages/droplets/test/fixtures/app`) with a stand-in for the assets
binding, so `@dropletsjs/droplets` must be built first. `worker.ts` is a
tsdown entry: `cloudflare()` finds `dist/worker.js` by path.

## Facts

- `cloudflare()` returns the adapter named `cloudflare`. `src/index.ts:290`
- `cloudflare()` serverEntry is `dist/worker.js` of this package, found by path. `src/index.ts:291`
- `cloudflare()` serverFile: `vite build` writes the Worker as `dist/worker.js`. `src/index.ts:292`
- `cloudflare()` separateSsrBundle is false: the SSR renderer is inlined through `virtual:droplets-ssr`, no `dist/server/`. `src/index.ts:294`, `src/worker.ts:3`, `test/index.test.ts:25`
- `cloudflare()` noExternal is `true`: every dependency is bundled into `dist/worker.js`, which has no `import` left. `src/index.ts:296`, `test/index.test.ts:27`
- `dist/worker.js` imports no `node:*` module from core or the renderer. `test/index.test.ts:36`
- `cloudflare()` defines `process.env.NODE_ENV` at build time: the build's `NODE_ENV`, else `production`. `src/index.ts:302`
- `cloudflare()` resolve conditions are `workerd`, `worker` and Vite's server conditions without `node`. `src/index.ts:304`
- `cloudflare()` build target is `es2022`. `src/index.ts:307`
- `assetsBinding` defaults to `ASSETS`. `src/index.ts:288`
- `assetsBinding` is baked into `dist/worker.js` as `__DROPLETS_ASSETS_BINDING__` through the output intro. `src/index.ts:311`, `src/worker.ts:17`
- `cloudflare()` has no `preview`: `vite preview` warns and serves nothing. `src/index.ts:287`, `../../droplets/src/vite/plugin.ts:621`
- `.assetsignore` is written to `dist/client/` after every build with `/droplets.json` and `/.vite/`. `src/index.ts:25`, `src/index.ts:318`, `test/index.test.ts:42`
- `afterBuild` receives the file-header table from the plugin as `fileHeaders` (`fileHeaderTable(config)`, internal to `@dropletsjs/droplets`): `publicCacheControl` comes from `droplets.config.ts`. `src/index.ts:316`, `../../droplets/src/vite/plugin.ts:614`, `../../droplets/src/runtime/file-headers.ts:30`
- `_headers` is written to `dist/client/` after every build: the adapter's rules, then the project root's `_headers` after a blank line. `src/index.ts:320`, `src/index.ts:321`, `test/index.test.ts:46`, `test/index.test.ts:250`
- `_headers` has one rule per row of the table, in its order, the pattern written as it is (Cloudflare reads `:name` and `*` alike): `/index.js` and `/index.css` (`no-store`), `/assets/*`, `/assets/public/*`, `/assets/prerendered/*`, `/droplets/:id/client.js`, `/droplets/:id/style.css`. `src/index.ts:171`, `../../droplets/src/runtime/file-headers.ts:30`, `test/index.test.ts:169`
- `_headers` gives a path the headers of the table's last rule that matches it, as the server does: a rule writes only what differs from the last earlier rule that covers it, detaches (`! Name`) a header it replaces or leaves out, and detaches what an earlier rule that overlaps it only in part may have set. `src/index.ts:145`, `src/index.ts:107`, `src/index.ts:122`, `test/index.test.ts:179`
- `_headers` sends `Access-Control-Allow-Origin: *` and `X-Content-Type-Options: nosniff` on every path of the table, as every rule of the table carries them; `/assets/public/*` and `/assets/prerendered/*` get them from `/assets/*`, as they differ only in `Cache-Control`; the `cors` config is not read. `../../droplets/src/runtime/file-headers.ts:23`, `test/index.test.ts:169`
- `_headers` detaches `Cache-Control` before a rule sets or leaves it out where no earlier rule covers it: static assets send a `Cache-Control` of their own. `src/index.ts:135`, `src/index.ts:160`
- `_headers` cache for `/assets/*`, `client.js` and `style.css` is `public, max-age=2592000, immutable`. `../../droplets/src/runtime/file-headers.ts:35`, `../../droplets/src/runtime/file-headers.ts:45`
- `_headers` `/assets/public/*` carries `publicCacheControl`; `false` leaves only `! Cache-Control`. `../../droplets/src/runtime/file-headers.ts:38`, `test/index.test.ts:173`, `test/index.test.ts:175`
- `_headers` `/assets/prerendered/*` carries `fragmentCacheControl` with `no-transform` (`private, no-store, no-transform` by default, `no-transform` for `false`) after `! Cache-Control`, and no CORS or nosniff line of its own; a project `_headers` rule for it that starts with `! Cache-Control` replaces it. `../../droplets/src/runtime/file-headers.ts:43`, `test/index.test.ts:225`, `test/index.test.ts:242`
- `_headers` over 100 rules or with a line over 2,000 characters warns once, never fails. `src/index.ts:188`, `src/index.ts:323`, `test/index.test.ts:267`
- `_headers` in `public/` (found at `dist/client/assets/public/_headers`) warns once: Cloudflare reads only `dist/client/_headers`. `src/index.ts:326`, `test/index.test.ts:257`
- `_headers` is not in `.assetsignore`: Cloudflare never serves it as a file. `src/index.ts:25`
- Wrangler config is looked up as `wrangler.jsonc`, `wrangler.json`, then `wrangler.toml` in the project root; the first that exists is read. `src/index.ts:27`, `src/index.ts:330`
- Wrangler config is never written by the adapter. `src/index.ts:339`
- Wrangler config missing: logs (info) what to set for `main`, `assets.directory` and `assets.binding`, nothing about `run_worker_first`. `src/index.ts:332`, `test/index.test.ts:370`
- Wrangler JSONC is read with `//` and `/* */` comments and trailing commas removed. `src/index.ts:35`
- Wrangler TOML: `run_worker_first` is read from the `[assets]` section, one line, `#` comments allowed, single quotes taken as double. `src/index.ts:67`
- `run_worker_first` that does not parse warns `cloudflare-wrangler-unreadable` (`could not read the wrangler config (assets.run_worker_first, compatibility_flags)`, with the file) and the build goes on. `src/index.ts:342`, `test/index.test.ts:370`
- `run_worker_first` unset, `false` or a list that matches none of the build's files is silent. `src/index.ts:218`, `test/index.test.ts:286`
- `run_worker_first` `true` sends every build file through the Worker and warns once, never fails. `src/index.ts:217`, `test/index.test.ts:305`
- `run_worker_first` list warns when a pattern matches a build file and no `!` pattern excludes it: negative patterns win. `src/index.ts:216`, `src/index.ts:222`, `test/index.test.ts:305`
- `run_worker_first` patterns are matched against `/index.js`, `/index.css`, `/assets/index.js`, `/assets/public/index.txt`, `/droplets/x/client.js`, `/droplets/x/style.css`, `/assets/prerendered/x/y`, and from `droplets.json` the entry module, each droplet's `client.js` and the `style.css` of each droplet with stylesheets. `src/index.ts:231`, `src/index.ts:247`, `test/index.test.ts:346`
- `assets.html_handling` `"none"` or `"force-trailing-slash"` warns once after a build that wrote `dist/client/assets/prerendered/`, never fails: `<file>: assets.html_handling is "none", so /assets/prerendered/<id>/<file> answers 404 (only <file>.html is served)…`, or `… is "force-trailing-slash", so /assets/prerendered/<id>/<file> redirects to /assets/prerendered/<id>/<file>/…`, linking `https://dropletsjs.dev/guides/prerendering/#static-files`; the default and `drop-trailing-slash` are silent. `src/index.ts:349`, `src/index.ts:352`, `test/index.test.ts:388`
- `assets.html_handling` is read from `[assets]` in TOML and `assets` in JSON or JSONC. `src/index.ts:80`, `src/index.ts:90`
- `run_worker_first` pattern `*` matches anything, `/` included. `src/index.ts:201`
- `compatibility_flags` without a flag starting with `nodejs_compat` (missing, empty, not a list) warns once after the build, never fails: `<file>: compatibility_flags has no "nodejs_compat", so the Worker has no AsyncLocalStorage…`, linking `https://dropletsjs.dev/guides/deployment/#cloudflare-workers`. `src/index.ts:97`, `src/index.ts:346`, `test/index.test.ts:431`
- `compatibility_flags` is read from the top level of the wrangler config (JSON, JSONC or TOML), never from an `env.*` section. `src/index.ts:75`, `src/index.ts:89`
- A wrangler config this reader cannot parse warns once that `assets.run_worker_first` and `compatibility_flags` go unchecked. `src/index.ts:342`
- `run_worker_first` warning names the file, the value and up to five matched paths, and links `https://dropletsjs.dev/guides/deployment/#run_worker_first`. `src/index.ts:359`
- Config in the Worker is `resolveConfig(userConfig)` with no environment: `PORT` is never read. `src/worker.ts:120`
- `droplets.config.ts` that exports a function is called in `dist/worker.js` with the build's `{ command, mode, isSsrBuild, isPreview }` and awaited on the first request, never at the top level: a Worker module has no top-level `await`. `src/worker.ts:26`, `src/worker.ts:119`, `test/worker.test.ts:472`
- Manifest is inlined into the Worker through `virtual:droplets-manifest`, the build's `droplets.json`. `src/worker.ts:2`, `../../droplets/src/vite/virtual.ts:71`
- Assets binding missing from `env`: the request throws `cloudflare-assets-binding-missing` (`the Worker has no "<name>" binding`). `src/worker.ts:126`, `test/worker.test.ts:358`
- App is created once per assets binding object and kept in a `WeakMap`, as the promise of its creation. `src/worker.ts:33`, `src/worker.ts:131`
- Bindings are the runtime env: every request calls `setRuntimeEnv(env)` before it is answered. `src/worker.ts:140`
- `platform.env` is the Worker's `env`, every binding included. `../../droplets/src/runtime/app.ts:631`, `test/worker.test.ts:100`
- `platform.context` is the Worker's execution context when the runtime has one. `../../droplets/src/runtime/app.ts:580`
- `.env` values are not in `dist/worker.js`; runtime secrets come from the bindings. `test/worker.test.ts:116`
- `DROPLETS_TRUSTED_ORIGINS` binding is read per request, for form posts and for the location headers it trusts. `../../droplets/src/runtime/app.ts:695`, `test/worker.test.ts:226`, `test/worker.test.ts:316`
- Droplet lookup in the inlined manifest uses `Object.hasOwn`: `__proto__` and other prototype names find nothing. `src/worker.ts:49`, `test/worker.test.ts:309`
- Files are read through the binding by pathname; the origin `https://assets.invalid` is a placeholder. `src/worker.ts:56`
- File the binding answers with a non-2xx status reads as missing (`null`). `src/worker.ts:57`
- Client bundles, `/index.js` and `/index.css` (the stub `__globalStyle` names) are fetched from the binding per request. `src/worker.ts:62`, `src/worker.ts:66`, `src/worker.ts:68`
- `/index.js` and `/index.css` answer `cache-control: no-store`. `test/worker.test.ts:170`, `test/worker.test.ts:178`
- Droplet styles and the entry module name come from the inlined manifest, not the binding. `src/worker.ts:67`, `src/worker.ts:77`
- Prerendered renders are read through the binding from `_prerendered/<random>`; they are never in the bundle. `src/worker.ts:73`, `test/worker.test.ts:129`
- Prerendered folder name is `_prerendered/` plus 32 hex characters, new every build, and only `droplets.json` holds it. `../../droplets/src/vite/prerender.ts:62`, `test/worker.test.ts:130`
- Prerendered renders, `droplets.json` and `/.vite/manifest.json` answer 404 from the Worker. `test/worker.test.ts:140`
- `/assets/*` forwards the original request to the binding. `src/worker.ts:83`
- `/assets/*` binding 404 answers the text `Not Found`, `404`, `cache-control: no-store`, the same answer as the Node adapter's, never the binding's own page. `src/worker.ts:85`, `test/worker.test.ts:193`
- `/assets/*` binding answer with any other status of 400 or more passes through with `cache-control: no-store`, so a file missing now is not cached past the deploy that adds it. `src/worker.ts:86`, `src/worker.ts:95`, `test/worker.test.ts:193`
- `/assets/*` answered 2xx or 304 gets the headers of the last rule of the file-header table that matches it from `createServerApp`, as every other build file the Worker answers does; a status from 300 to 399 other than 304 passes through untouched. `src/worker.ts:88`, `../../droplets/src/server/app.ts:125`, `../../droplets/src/runtime/app.ts:1258`, `test/worker.test.ts:277`
- `/assets/*` hashed file gets `cache-control: public, max-age=2592000, immutable` and `x-content-type-options: nosniff`. `../../droplets/src/runtime/file-headers.ts:23`, `../../droplets/src/runtime/file-headers.ts:35`
- `/assets/public/*` answered by the Worker gets `publicCacheControl` from the config (`no-cache` by default; `false` removes the binding's); a 304 or a binding `ETag` is passed on. `../../droplets/src/runtime/file-headers.ts:38`, `../../droplets/src/runtime/file-headers.ts:83`, `src/worker.ts:104`
- `/assets/public/*` without a binding `ETag` gets one from the SHA-1 of the body in base64url, and `304` with no body when `If-None-Match` lists it. `src/worker.ts:106`, `src/worker.ts:112`
- `/assets/public/*` and `/assets/prerendered/*` status from 300 to 399 other than 304 passes through untouched. `src/worker.ts:88`
- `/assets/prerendered/*` answered by the Worker is revalidated as `/assets/public/*` is (the binding's `ETag` or one from the SHA-1, `304`), with the live fragment's `cache-control` from the table, never `immutable`. `src/worker.ts:87`, `../../droplets/src/runtime/file-headers.ts:43`, `test/worker.test.ts:240`
- `/robots.txt` answers 404: `public/` is served only under `/assets/public/`. `test/worker.test.ts:210`
- `/assets/*`, `/index.js` and `/index.css` never pass through `handle`. `../../droplets/src/runtime/app.ts:1159`, `test/worker.test.ts:303`
- `nodejs_compat` gives `AsyncLocalStorage`, found through `process.getBuiltinModule`; without it overlapping requests share one request store. `../../droplets/src/runtime/request-store.ts:46`, `../../droplets/src/runtime/request-store.ts:60`
- Node engine for the build is `>=22`. `package.json:36`
- `vite` is a peer dependency (`^8.0.0`): the adapter reads `defaultServerConditions` from it. `package.json:49`, `src/index.ts:7`
- Build script runs the tests before tsdown. `package.json:39`
- Tests build the framework's fixture app with `buildFixtureApp()` from `@dropletsjs/shared/vitest`, which fails when `@dropletsjs/droplets` is not built. `test/build-fixture.ts:13`, `../../shared/vitest.ts:34`
- A droplet without stylesheets has no `style.css` (404), and `/index.css` answers 404 without a shared stylesheet: the binding has no such file. `src/worker.ts:64`, `test/worker.test.ts:324`

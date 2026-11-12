# @dropletsjs/adapter-cloudflare

The Cloudflare Workers adapter for [Droplets](../../droplets). With it,
`vite build` writes `dist/worker.js`: one self-contained Worker with the SSR
renderer, your config and the manifest inlined. The client build in
`dist/client` is served through Workers Static Assets, with the headers of
the `dist/client/_headers` the build writes.

```bash
pnpm add -D @dropletsjs/adapter-cloudflare@alpha wrangler
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
gives them their headers:

- `/index.js` and `/index.css`: `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`.
- `/assets/*`, `/droplets/:id/client.js`, `/droplets/:id/style.css`:
  `Access-Control-Allow-Origin: *`, `Cache-Control: public,
  max-age=2592000, immutable`.
- `/assets/public/*`: `Cache-Control` from `publicCacheControl`
  (`no-cache` by default); with `false`, none.
- Every rule but `/assets/public/*` (which gets it from `/assets/*`) adds
  `X-Content-Type-Options: nosniff`, as the Worker does on the files it
  serves itself.

Each rule starts with `! Cache-Control`: Cloudflare applies every rule that
matches and joins a header two rules set with a comma. Your own `_headers`,
in the project root, is appended after these rules. A `public/_headers`
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
- Every file Vite emits there is content-hashed: `cache-control: public,
  max-age=2592000, immutable` on a successful answer.
- `/assets/public/*` keeps its names, so it is revalidated:
  `cache-control: no-cache` (`publicCacheControl`) with the binding's own `ETag` and `304`; when the
  binding sends no `ETag`, one is made from the SHA-1 of the content and
  `If-None-Match` is answered with `304`.
- Nothing else in `dist/client` is a Worker route: `/robots.txt` answers 404.

The Worker reads droplet bundles, `/index.js` and the global CSS through
the binding when it answers them; the manifest itself is in the bundle.

### Environment

The bindings (vars and secrets) are the runtime environment: each request
sets them as the source of `$droplets/env` private variables,
`DROPLETS_SECRET`, `DROPLETS_TRUSTED_ORIGINS` and `DROPLETS_ENV_MAX_AGE`, and
`platform.env` in server code holds all of them. `.env` files are a build
input only. Set the secret with `wrangler secret put DROPLETS_SECRET`.
`PORT` and `server.port` do not apply: the platform decides the address. Set
`cors` in the config if pages on other origins embed your droplets. See
[Deployment](https://dropletsjs.dev/guides/deployment/).

### Changing this package

`pnpm --filter @dropletsjs/adapter-cloudflare build` runs the tests, then
tsdown. The tests build the framework's own fixture
(`packages/droplets/test/fixtures/app`) with a stand-in for the assets
binding, so `@dropletsjs/droplets` must be built first. `worker.ts` is a
tsdown entry: `cloudflare()` finds `dist/worker.js` by path.

## Facts

- `cloudflare()` returns the adapter named `cloudflare`. `src/index.ts:187`
- `cloudflare()` serverEntry is `dist/worker.js` of this package, found by path. `src/index.ts:188`
- `cloudflare()` serverFile: `vite build` writes the Worker as `dist/worker.js`. `src/index.ts:189`
- `cloudflare()` separateSsrBundle is false: the SSR renderer is inlined through `virtual:droplets-ssr`, no `dist/server/`. `src/index.ts:191`, `src/worker.ts:3`, `test/index.test.ts:24`
- `cloudflare()` noExternal is `true`: every dependency is bundled into `dist/worker.js`, which has no `import` left. `src/index.ts:193`, `test/index.test.ts:26`
- `dist/worker.js` imports no `node:*` module from core or the renderer. `test/index.test.ts:34`
- `cloudflare()` defines `process.env.NODE_ENV` at build time: the build's `NODE_ENV`, else `production`. `src/index.ts:199`
- `cloudflare()` resolve conditions are `workerd`, `worker` and Vite's server conditions without `node`. `src/index.ts:201`
- `cloudflare()` build target is `es2022`. `src/index.ts:204`
- `assetsBinding` defaults to `ASSETS`. `src/index.ts:185`
- `assetsBinding` is baked into `dist/worker.js` as `__DROPLETS_ASSETS_BINDING__` through the output intro. `src/index.ts:208`, `src/worker.ts:14`
- `cloudflare()` has no `preview`: `vite preview` warns and serves nothing. `src/index.ts:186`, `../../droplets/src/vite/plugin.ts:536`
- `.assetsignore` is written to `dist/client/` after every build with `/droplets.json` and `/.vite/`. `src/index.ts:15`, `src/index.ts:215`, `test/index.test.ts:40`
- `afterBuild` receives the resolved config from the plugin: `publicCacheControl` comes from `droplets.config.ts`. `src/index.ts:213`, `../../droplets/src/vite/plugin.ts:544`
- `_headers` is written to `dist/client/` after every build: the adapter's rules, then the project root's `_headers` after a blank line. `src/index.ts:216`, `src/index.ts:218`, `test/index.test.ts:44`, `test/index.test.ts:109`
- `_headers` rules: `/index.js` and `/index.css` (`no-store`), `/assets/*`, `/assets/public/*`, `/droplets/:id/client.js`, `/droplets/:id/style.css`, in that order. `src/index.ts:79`, `src/index.ts:80`, `test/index.test.ts:99`
- `_headers` sends `Access-Control-Allow-Origin: *` on every rule but `/assets/public/*`, which gets it from `/assets/*`; the `cors` config is not read. `src/index.ts:76`
- `_headers` sends `X-Content-Type-Options: nosniff` on the same rules, and the Worker sets it on every file it serves through the binding. `src/index.ts:76`, `src/worker.ts:83`, `src/worker.ts:100`
- `_headers` starts every rule with `! Cache-Control`: Cloudflare joins a header two matching rules set, and static assets send a `Cache-Control` of their own. `src/index.ts:76`, `src/index.ts:77`
- `_headers` cache for `/assets/*`, `client.js` and `style.css` is `public, max-age=2592000, immutable`. `src/index.ts:64`
- `_headers` `/assets/public/*` carries `publicCacheControl`; `false` leaves only `! Cache-Control`. `src/index.ts:77`, `test/index.test.ts:102`, `test/index.test.ts:104`
- `_headers` over 100 rules or with a line over 2,000 characters warns once, never fails. `src/index.ts:87`, `src/index.ts:93`, `test/index.test.ts:126`
- `_headers` in `public/` (found at `dist/client/assets/public/_headers`) warns once: Cloudflare reads only `dist/client/_headers`. `src/index.ts:226`, `test/index.test.ts:116`
- `_headers` is not in `.assetsignore`: Cloudflare never serves it as a file. `src/index.ts:15`
- Wrangler config is looked up as `wrangler.jsonc`, `wrangler.json`, then `wrangler.toml` in the project root; the first that exists is read. `src/index.ts:17`, `src/index.ts:233`
- Wrangler config is never written by the adapter. `src/index.ts:243`
- Wrangler config missing: logs (info) what to set for `main`, `assets.directory` and `assets.binding`, nothing about `run_worker_first`. `src/index.ts:234`, `test/index.test.ts:209`
- Wrangler JSONC is read with `//` and `/* */` comments and trailing commas removed. `src/index.ts:25`
- Wrangler TOML: `run_worker_first` is read from the `[assets]` section, one line, `#` comments allowed, single quotes taken as double. `src/index.ts:54`
- `run_worker_first` that does not parse warns `could not read assets.run_worker_first in <file>` and the build goes on. `src/index.ts:248`, `test/index.test.ts:209`
- `run_worker_first` unset, `false` or a list that matches none of the build's files is silent. `src/index.ts:123`, `test/index.test.ts:143`
- `run_worker_first` `true` sends every build file through the Worker and warns once, never fails. `src/index.ts:122`, `test/index.test.ts:159`
- `run_worker_first` list warns when a pattern matches a build file and no `!` pattern excludes it: negative patterns win. `src/index.ts:121`, `src/index.ts:126`, `test/index.test.ts:159`
- `run_worker_first` patterns are matched against `/index.js`, `/index.css`, `/assets/index.js`, `/assets/public/index.txt`, `/droplets/x/client.js`, `/droplets/x/style.css`, and from `droplets.json` the entry module, each droplet's `client.js` and the `style.css` of each droplet with stylesheets. `src/index.ts:136`, `src/index.ts:144`, `test/index.test.ts:189`
- `run_worker_first` pattern `*` matches anything, `/` included. `src/index.ts:106`
- `compatibility_flags` without a flag starting with `nodejs_compat` (missing, empty, not a list) warns once after the build, never fails: `<file>: compatibility_flags has no "nodejs_compat", so the Worker has no AsyncLocalStorage…`, linking `https://dropletsjs.dev/guides/deployment/#cloudflare-workers`. `src/index.ts:80`, `src/index.ts:285`, `test/index.test.ts:244`
- `compatibility_flags` is read from the top level of the wrangler config (JSON, JSONC or TOML), never from an `env.*` section. `src/index.ts:58`, `src/index.ts:64`
- A wrangler config this reader cannot parse warns once that `assets.run_worker_first` and `compatibility_flags` go unchecked. `src/index.ts:278`
- `run_worker_first` warning names the file, the value and up to five matched paths, and links `https://dropletsjs.dev/guides/deployment/#run_worker_first`. `src/index.ts:253`
- Config in the Worker is `resolveConfig(userConfig)` with no environment: `PORT` is never read. `src/worker.ts:23`
- Manifest is inlined into the Worker through `virtual:droplets-manifest`, the build's `droplets.json`. `src/worker.ts:2`, `../../droplets/src/vite/virtual.ts:73`
- Assets binding missing from `env`: the request throws `droplets: no "<name>" binding`. `src/worker.ts:119`, `test/worker.test.ts:269`
- App is created once per assets binding object and kept in a `WeakMap`. `src/worker.ts:27`, `src/worker.ts:124`
- Bindings are the runtime env: every request calls `setRuntimeEnv(env)` before it is answered. `src/worker.ts:135`
- `platform.env` is the Worker's `env`, every binding included. `../../droplets/src/runtime/app.ts:525`, `test/worker.test.ts:87`
- `platform.context` is the Worker's execution context when the runtime has one. `../../droplets/src/runtime/app.ts:561`
- `.env` values are not in `dist/worker.js`; runtime secrets come from the bindings. `test/worker.test.ts:103`
- `DROPLETS_TRUSTED_ORIGINS` binding is read per request, for form posts and for the location headers it trusts. `../../droplets/src/runtime/app.ts:840`, `test/worker.test.ts:227`, `test/worker.test.ts:245`
- Droplet lookup in the inlined manifest uses `Object.hasOwn`: `__proto__` and other prototype names find nothing. `src/worker.ts:43`, `test/worker.test.ts:221`
- Files are read through the binding by pathname; the origin `https://assets.invalid` is a placeholder. `src/worker.ts:50`
- File the binding answers with a non-2xx status reads as missing (`null`). `src/worker.ts:51`
- Client bundles, `/index.js` and `/index.css` (the stub `__globalStyle` names) are fetched from the binding per request. `src/worker.ts:58`, `src/worker.ts:61`, `src/worker.ts:63`
- `/index.js` and `/index.css` answer `cache-control: no-store`. `test/worker.test.ts:157`, `test/worker.test.ts:164`
- Droplet styles and the entry module name come from the inlined manifest, not the binding. `src/worker.ts:61`, `src/worker.ts:71`
- Prerendered renders are read through the binding from `_prerendered/<random>`; they are never in the bundle. `src/worker.ts:67`, `test/worker.test.ts:124`
- Prerendered folder name is `_prerendered/` plus 32 hex characters, new every build, and only `droplets.json` holds it. `../../droplets/src/vite/prerender.ts:52`, `test/worker.test.ts:131`
- Prerendered renders, `droplets.json` and `/.vite/manifest.json` answer 404 from the Worker. `test/worker.test.ts:137`, `test/worker.test.ts:144`
- `/assets/*` forwards the original request to the binding. `src/worker.ts:77`
- `/assets/*` binding 404 answers the text `Not Found`, `404`, `cache-control: no-store`, the same answer as the Node adapter's, never the binding's own page. `src/worker.ts:79`, `test/worker.test.ts:180`
- `/assets/*` binding answer with any other status of 400 or more passes through with `cache-control: no-store`, so a file missing now is not cached past the deploy that adds it. `src/worker.ts:80`, `src/worker.ts:94`, `test/worker.test.ts:188`
- `/assets/*` hashed file answered 2xx gets `cache-control: public, max-age=2592000, immutable`; a status from 300 to 399 passes through untouched. `src/worker.ts:80`, `src/worker.ts:82`
- `/assets/public/*` answered by the Worker gets `publicCacheControl` from the config (`no-cache` by default; `false` removes the binding's); a 304 or a binding `ETag` is passed on. `src/worker.ts:86`, `src/worker.ts:101`, `src/worker.ts:102`
- `/assets/public/*` without a binding `ETag` gets one from the SHA-1 of the body in base64url, and `304` with no body when `If-None-Match` lists it. `src/worker.ts:104`, `src/worker.ts:110`
- `/assets/public/*` status from 300 to 399 other than 304 passes through untouched. `src/worker.ts:85`
- `/robots.txt` answers 404: `public/` is served only under `/assets/public/`. `test/worker.test.ts:195`
- `/assets/*`, `/index.js` and `/index.css` never pass through `handle`. `../../droplets/src/runtime/app.ts:900`, `test/worker.test.ts:214`
- `nodejs_compat` gives `AsyncLocalStorage`, found through `process.getBuiltinModule`; without it overlapping requests share one request store. `../../droplets/src/runtime/request-store.ts:46`, `../../droplets/src/runtime/request-store.ts:60`
- Node engine for the build is `>=22`. `package.json:36`
- `vite` is a peer dependency (`^8.0.0`): the adapter reads `defaultServerConditions` from it. `package.json:49`, `src/index.ts:6`
- Build script runs the tests before tsdown. `package.json:39`
- Tests build the framework's fixture app and fail when `@dropletsjs/droplets` is not built. `test/build-fixture.ts:18`
- A droplet without stylesheets has no `style.css` (404), and `/index.css` answers 404 without a shared stylesheet: the binding has no such file. `src/worker.ts:63`, `test/worker.test.ts:291`

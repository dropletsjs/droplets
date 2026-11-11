# @dropletsjs/adapter-cloudflare

The Cloudflare Workers adapter for [Droplets](../../droplets). With it,
`vite build` writes `dist/worker.js`: one self-contained Worker with the SSR
renderer, your config and the manifest inlined. The client build in
`dist/client` is served through Workers Static Assets.

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
    "binding": "ASSETS",
    // The Worker answers /index.js, /droplets/* and /assets/* itself.
    "run_worker_first": true
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

There is no `dist/server.js` and no `dist/server/` folder.

### The wrangler config

After the build, the adapter reads `assets.run_worker_first` from the first
of `wrangler.jsonc`, `wrangler.json` or `wrangler.toml` in the project root.
It never writes the file and never fails the build:

- `true`, or a list that covers `/index.js`, `/droplets/*` and `/assets/*`
  and excludes none of them (`!`), passes in silence.
- Anything else (unset, `false`, a list that misses a route) warns once:
  static assets would answer those paths without the Worker's CORS and
  `no-store` headers, so pages on another origin could not load them.
- A config it cannot parse warns that it could not read the value.
- No config at all logs what to set: `main`, `assets.directory` and
  `assets.run_worker_first: true`.

`nodejs_compat` gives the Worker `AsyncLocalStorage`. Without it, requests
that overlap share one request store: the last one to start wins.

### Static files

`/assets/*` is fetched from the assets binding and never passes through
`handle` from your hooks.

- Every file Vite emits there is content-hashed: `cache-control: public,
  max-age=2592000, immutable` on a successful answer.
- `/assets/public/*` keeps its names, so it is revalidated:
  `cache-control: no-cache` with the binding's own `ETag` and `304`; when the
  binding sends no `ETag`, one is made from the SHA-1 of the content and
  `If-None-Match` is answered with `304`.
- Nothing else in `dist/client` is a Worker route: `/robots.txt` answers 404.

Droplet bundles, `/index.js` and the global CSS are read through the
binding on each request; the manifest itself is in the bundle.

### Environment

The bindings (vars and secrets) are the runtime environment: each request
sets them as the source of `$droplets/env` private variables,
`DROPLETS_SECRET`, `DROPLETS_TRUSTED_ORIGINS` and `DROPLETS_ORIGIN`, and
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

- `cloudflare()` returns the adapter named `cloudflare`. `src/index.ts:137`
- `cloudflare()` serverEntry is `dist/worker.js` of this package, found by path. `src/index.ts:138`
- `cloudflare()` serverFile: `vite build` writes the Worker as `dist/worker.js`. `src/index.ts:139`
- `cloudflare()` separateSsrBundle is false: the SSR renderer is inlined through `virtual:droplets-ssr`, no `dist/server/`. `src/index.ts:141`, `src/worker.ts:3`, `test/index.test.ts:24`
- `cloudflare()` noExternal is `true`: every dependency is bundled into `dist/worker.js`, which has no `import` left. `src/index.ts:143`, `test/index.test.ts:26`
- `dist/worker.js` imports no `node:*` module from core or the renderer. `test/index.test.ts:34`
- `cloudflare()` defines `process.env.NODE_ENV` at build time: the build's `NODE_ENV`, else `production`. `src/index.ts:149`
- `cloudflare()` resolve conditions are `workerd`, `worker` and Vite's server conditions without `node`. `src/index.ts:151`
- `cloudflare()` build target is `es2022`. `src/index.ts:154`
- `assetsBinding` defaults to `ASSETS`. `src/index.ts:135`
- `assetsBinding` is baked into `dist/worker.js` as `__DROPLETS_ASSETS_BINDING__` through the output intro. `src/index.ts:158`, `src/worker.ts:14`
- `cloudflare()` has no `preview`: `vite preview` warns and serves nothing. `src/index.ts:136`, `../../droplets/src/vite/plugin.ts:555`
- `.assetsignore` is written to `dist/client/` after every build with `/droplets.json` and `/.vite/`. `src/index.ts:15`, `src/index.ts:164`, `test/index.test.ts:41`
- Wrangler config is looked up as `wrangler.jsonc`, `wrangler.json`, then `wrangler.toml` in the project root; the first that exists is read. `src/index.ts:17`, `src/index.ts:165`
- Wrangler config is never written by the adapter. `src/index.ts:175`
- Wrangler config missing: logs (info) what to set for `main`, `assets.directory` and `assets.run_worker_first`. `src/index.ts:166`
- Wrangler JSONC is read with `//` and `/* */` comments and trailing commas removed. `src/index.ts:22`
- Wrangler TOML: `run_worker_first` is read from the `[assets]` section, one line, `#` comments allowed, single quotes taken as double. `src/index.ts:50`
- `run_worker_first` that does not parse warns `could not read assets.run_worker_first in <file>` and the build goes on. `src/index.ts:176`, `test/index.test.ts:123`
- `run_worker_first` `true` passes without a warning. `src/index.ts:94`
- `run_worker_first` list passes when it covers `/index.js`, `/droplets/*` and `/assets/*` and no `!` entry touches them. `src/index.ts:60`, `src/index.ts:99`
- `run_worker_first` pattern `*` matches anything, `/` included; a pattern with `*` covers a `*` route only when its single `*` is last. `src/index.ts:67`, `src/index.ts:76`
- `run_worker_first` unset, `false` or a list that misses a route warns once, never fails. `src/index.ts:181`, `test/index.test.ts:92`
- `run_worker_first` warning names the file and the value and links `https://dropletsjs.dev/guides/deployment/#run_worker_first`. `src/index.ts:62`, `src/index.ts:184`
- Config in the Worker is `resolveConfig(userConfig)` with no environment: `PORT` is never read. `src/worker.ts:23`
- Manifest is inlined into the Worker through `virtual:droplets-manifest`, the build's `droplets.json`. `src/worker.ts:2`, `../../droplets/src/vite/virtual.ts:670`
- Assets binding missing from `env`: the request throws `droplets: no "<name>" binding`. `src/worker.ts:108`, `test/worker.test.ts:261`
- App is created once per assets binding object and kept in a `WeakMap`. `src/worker.ts:27`, `src/worker.ts:113`
- Bindings are the runtime env: every request calls `setRuntimeEnv(env)` before it is answered. `src/worker.ts:124`
- `platform.env` is the Worker's `env`, every binding included. `../../droplets/src/runtime/app.ts:517`, `test/worker.test.ts:87`
- `platform.context` is the Worker's execution context when the runtime has one. `../../droplets/src/runtime/app.ts:553`
- `.env` values are not in `dist/worker.js`; runtime secrets come from the bindings. `test/worker.test.ts:103`
- `DROPLETS_TRUSTED_ORIGINS` and `DROPLETS_ORIGIN` bindings are read per request. `../../droplets/src/runtime/app.ts:832`, `../../droplets/src/runtime/app.ts:837`, `test/worker.test.ts:219`
- Droplet lookup in the inlined manifest uses `Object.hasOwn`: `__proto__` and other prototype names find nothing. `src/worker.ts:41`, `test/worker.test.ts:213`
- Files are read through the binding by pathname; the origin `https://assets.invalid` is a placeholder. `src/worker.ts:48`
- File the binding answers with a non-2xx status reads as missing (`null`). `src/worker.ts:49`
- Client bundles, `/index.js` and the global CSS are fetched from the binding per request. `src/worker.ts:56`, `src/worker.ts:58`, `src/worker.ts:60`
- `/index.js` answers `cache-control: no-store`. `test/worker.test.ts:157`
- Droplet styles and the entry module name come from the inlined manifest, not the binding. `src/worker.ts:59`, `src/worker.ts:69`
- Prerendered renders are read through the binding from `_prerendered/<random>`; they are never in the bundle. `src/worker.ts:65`, `test/worker.test.ts:124`
- Prerendered folder name is `_prerendered/` plus 32 hex characters, new every build, and only `droplets.json` holds it. `../../droplets/src/vite/prerender.ts:52`, `test/worker.test.ts:131`
- Prerendered renders, `droplets.json` and `/.vite/manifest.json` answer 404 from the Worker. `test/worker.test.ts:137`, `test/worker.test.ts:144`
- `/assets/*` forwards the original request to the binding. `src/worker.ts:74`
- `/assets/*` hashed file answered 2xx gets `cache-control: public, max-age=2592000, immutable`; any other status passes through untouched. `src/worker.ts:76`, `src/worker.ts:78`
- `/assets/public/*` gets `cache-control: no-cache`; a 304 or a binding `ETag` is passed on. `src/worker.ts:90`, `src/worker.ts:91`
- `/assets/public/*` without a binding `ETag` gets one from the SHA-1 of the body in base64url, and `304` with no body when `If-None-Match` lists it. `src/worker.ts:93`, `src/worker.ts:99`
- `/assets/public/*` error status other than 304 passes through untouched. `src/worker.ts:81`
- `/robots.txt` answers 404: `public/` is served only under `/assets/public/`. `test/worker.test.ts:187`
- `/assets/*` and `/index.js` never pass through `handle`. `../../droplets/src/runtime/app.ts:892`, `test/worker.test.ts:206`
- `nodejs_compat` gives `AsyncLocalStorage`, found through `process.getBuiltinModule`; without it overlapping requests share one request store. `../../droplets/src/runtime/request-store.ts:46`, `../../droplets/src/runtime/request-store.ts:60`
- Node engine for the build is `>=22`. `package.json:36`
- `vite` is a peer dependency (`^8.0.0`): the adapter reads `defaultServerConditions` from it. `package.json:49`, `src/index.ts:6`
- Build script runs the tests before tsdown. `package.json:39`
- Tests build the framework's fixture app and fail when `@dropletsjs/droplets` is not built. `test/build-fixture.ts:18`
- A droplet without stylesheets has no `style.css` (404), and `/index.css` answers 404 without a shared stylesheet: the binding has no such file. `src/worker.ts:61`, `test/worker.test.ts:283`

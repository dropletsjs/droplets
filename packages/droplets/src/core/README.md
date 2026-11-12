# core

What the build, the dev server and the production server agree on: the
config with its defaults, which droplets exist and with which flags, the
`+server.ts` routes, the `src/env.ts` declaration, the logger and where the
compiled runtime files sit. `config.ts` and `logger.ts` run anywhere (they
ship in the production server); the rest is build tooling on Node.

```ts
import { resolveConfig } from "./config.ts";
import { discoverDroplets } from "./discover.ts";

const config = resolveConfig({ element: "my-widgets" }, { port: process.env["PORT"] });
const droplets = await discoverDroplets({ dropletsRoot: "/app/src/droplets", renderers, dev: false });
```

## Details

### Files

| File | What it does | Runs |
|---|---|---|
| `config.ts` | `DropletsConfig`, `resolveConfig`, `resolveDevConfig`, `DEFAULTS`, `DEV_STRATEGIES`, origin and folder normalisation | anywhere (on the portability list) |
| `logger.ts` | `logger`, `setLogLevel`, `DEV_DROPLETS_LOG`: the log of `vite dev` and `vite build`, never in a production bundle | anywhere (on the portability list) |
| `load-config.ts` | finds and loads `droplets.config.*` through Vite, then resolves it | Node, build and dev |
| `discover.ts` | scans the droplets folder: ids, component files, renderers, flags, load files, error pages | Node, build and dev |
| `flags.ts` | parses `ssr`, `hydrate`, `prerender` out of a component's source | build and dev (parses with Vite) |
| `env.ts` | loads `src/env.ts` and `.env` values; generates `$droplets/env/public` and `$droplets/env/private` | Node, build and dev |
| `api-routes.ts` | scans the API folder for `+server.ts` and turns folders into route segments | Node, build and dev |
| `paths.ts` | absolute paths of the compiled runtime files in this package's `dist/` | Node, build and dev |
| `fs.ts` | small `node:fs` helpers: missing files read as `null` or `false` | Node |
| `app-thread.ts` | an app answering from a worker thread: `connect` and `answer`, requests and responses as plain data | Node, the build and the conformance kit |

### Config

`droplets.config.ts` (or `.mts`, `.js`, `.mjs`) default-exports a plain
object; `config()` from `@dropletsjs/droplets` only adds types. The plugin
loads it with Vite's `loadConfigFromFile`, then `resolveConfig` fills in the
defaults and validates; `resolveDevConfig` resolves `dev` apart, so a
production server never carries it.

| Key | Default | Validation |
|---|---|---|
| `dropletsFolder`, `apiFolder` | `src/droplets`, `src/api` | normalised: `\` to `/`, `.` and empty segments dropped, `..` pops one |
| `health` | `/health` | starts with `/`; no `?`, `#`, whitespace; not `/`, `/index.js`, `/env.js`, `/index.css`, nor under `/droplets`, `/assets`, `/api` |
| `importMap` | `/importmap`, only when the client build has externals | same path rules; `health` may not equal it or `<importMap>.js` |
| `index` | absent: root `index.html` or a placeholder | kept as given |
| `element` | `djs-droplet` | `^[a-z][a-z0-9._]*-[a-z0-9._-]*$` |
| `cors` | off | `true` becomes `{ origin: "*" }`, an object passes through |
| `location` | absent: computed per request | one `http(s)` location with an optional path prefix; never `"*"` |
| `host` | absent: computed per request | one bare origin, no path; never `"*"` |
| `trustedOrigins` | `[]` | an array; each `"*"` or a bare origin, no path |
| `fragmentCacheControl` | `private, no-store` | non-empty, no CR/LF, trimmed; `false` sends none |
| `publicCacheControl` | `no-cache` | as `fragmentCacheControl`; `/assets/public/*` only |
| `csrf.checkOrigin`, `warnImportMap` | `true` | |
| `limits` | json 1 MB, form 1 MB, multipart 10 MB, props 8 KB | each a positive number; `Infinity` lifts it |
| `server.port` | `8000` | `PORT` wins |
| `dev.server.port` | `5173` | `PORT` wins |
| `dev.strategy` | `"hmr"` | one of `DEV_STRATEGIES` |
| `dev.injectTool` | `false` | |

`"*"` in `trustedOrigins` is accepted, never refused; the warning it earns
is the runtime's (`runtime/security.ts`). `DROPLETS_TRUSTED_ORIGINS` is not
read here: the runtime adds it per request through `normalizeTrustedOrigins`.

### Discovery and flags

A droplet is an immediate subfolder of `dropletsFolder` holding one
`+droplet.<suffix>` (or `+Droplet.<suffix>`), in a folder named in lowercase
kebab-case (`product-card`). Its id is the folder name. A folder with another
name (`ProductCard`, `hello_world`) is ignored, with one warning listing them.
The renderer is the one that claims the suffix; when several
renderers share it (`.tsx`), the component's imports decide. The flags are
read from the component file only, by the renderer's `readFlags` or by the
default parser: top-level `export const ssr | hydrate | prerender = <literal>`.
Flags anywhere else (`+droplet.ts`, `+droplet.server.ts`, `+error.*`) are
not read; an error page's flags warn in dev.

### Changing this folder

Keep `config.ts` and `logger.ts` free of Node APIs (`test/portability.test.ts`).
A new file in `paths.ts` must also be a tsdown `entry` in `tsdown.config.ts`.
Tests live in `test/core/`, one per file here. `pnpm --filter @dropletsjs/droplets build`
builds and runs them.

## Facts

- `DropletsConfig` is the shape of `droplets.config.ts`'s default export; `config()` returns its argument unchanged. `config.ts:11`, `config.ts:216`
- `DEFAULTS` holds every default: folders, `health`, `importMap`, `element`, ports, `limits`, `fragmentCacheControl`, `publicCacheControl`. `config.ts:199`
- `dropletsFolder` defaults to `src/droplets`. `config.ts:200`
- `apiFolder` defaults to `src/api`. `config.ts:201`
- `dropletsFolder` and `apiFolder` normalisation: `\` becomes `/`, empty and `.` segments drop, `..` pops a segment. `config.ts:245`
- `dropletsFolder` normalisation drops a leading `..` silently: `../elsewhere` becomes `elsewhere`. `config.ts:248`
- `dropletsFolder` that normalises to nothing falls back to the default. `config.ts:253`
- `health` defaults to `/health`; `false` turns it off. `config.ts:202`, `config.ts:389`
- `health` and `importMap` paths must start with `/` and hold no `?`, `#` or whitespace, else `resolveConfig` throws. `config.ts:263`
- `health` and `importMap` may not be `/`, `/index.js`, `/env.js`, `/index.css` or under `/droplets`, `/assets`, `/api`. `config.ts:257`, `config.ts:258`
- `health` equal to `importMap` or to `<importMap>.js` throws. `config.ts:400`
- `importMap` defaults to `/importmap`; `auto` is true only when the key is unset (served only when the client build has externals). `config.ts:203`, `config.ts:397`
- `importMap: false` turns the import map routes off. `config.ts:392`
- `index` is kept as given; absent, the resolved config has no `index` key. `config.ts:411`
- `element` defaults to `djs-droplet`. `config.ts:204`
- `element` must match `^[a-z][a-z0-9._]*-[a-z0-9._-]*$`, else `resolveConfig` throws. `config.ts:276`, `config.ts:382`
- `isValidElementName` is the same check, exported from `@dropletsjs/droplets`. `config.ts:278`, `../index.ts:1`
- `cors: true` resolves to `{ origin: "*" }`; an object passes through; anything else leaves `cors` unset. `config.ts:387`
- `location` is one string; anything else, a list or `"*"` included, throws `location takes this server's public URL`. `config.ts:330`, `config.ts:332`
- `location` is an `http:` or `https:` URL only. `config.ts:322`
- `location` refuses credentials and a `*` in the hostname (`https://*.example`). `config.ts:324`
- `location` refuses `\`, `#` and `?`. `config.ts:315`
- `location` with a path keeps it as a prefix, trailing slashes trimmed, when `isLocationPrefix` accepts it. `config.ts:326`
- `isLocationPrefix` takes a prefix that starts with `/`, is at most 256 characters, and has no `//`, `\`, `..`, `?`, `#` or control character. `../runtime/web-url.ts:46`
- `location` with the path `/` resolves to the bare origin. `config.ts:325`
- `location` absent leaves the resolved config without a `location` key. `config.ts:416`
- `host` is one bare origin (no path), checked as a `trustedOrigins` entry and resolved to `scheme://host[:port]`; anything else, `"*"` included, throws `host takes the origin of the page`. `config.ts:342`, `config.ts:344`, `config.ts:285`
- `host` absent leaves the resolved config without a `host` key. `config.ts:417`
- `trustedOrigins` must be an array, else `resolveConfig` throws. `config.ts:300`
- `trustedOrigins` entry `"*"` is kept as is. `config.ts:304`
- `trustedOrigins` entries are bare origins (no path), resolved to `scheme://host[:port]`. `config.ts:293`, `config.ts:294`
- `DROPLETS_TRUSTED_ORIGINS` is not read in core: the runtime parses it per request with `normalizeTrustedOrigins`, skipping bad entries (a warning under `vite dev`). `../runtime/security.ts:58`
- `"*"` warning (`trusts any forwarded location`) is the runtime's dev log, not core's. `../runtime/dev-log.ts:49`
- `fragmentCacheControl` defaults to `private, no-store`; `false` sends none. `config.ts:208`, `config.ts:355`
- `fragmentCacheControl` must be a non-empty string without CR or LF; it is trimmed. `config.ts:356`
- `publicCacheControl` defaults to `no-cache`, `false` sends none, and is checked by the same `resolveCacheControl` as `fragmentCacheControl`, the error naming the option. `config.ts:209`, `config.ts:353`, `config.ts:427`
- `csrf.checkOrigin` defaults to `true`. `config.ts:429`
- `warnImportMap` defaults to `true`. `config.ts:414`
- `limits` defaults: json 1 MB, form 1 MB, multipart 10 MB, props 8 KB. `config.ts:207`
- `limits` values must be numbers greater than 0, else `resolveConfig` throws; `Infinity` passes. `config.ts:365`
- `server.port` defaults to 8000. `config.ts:206`
- `PORT` is converted with `Number()`; empty, `0` or not a number counts as unset. `config.ts:386`
- `PORT` wins over `server.port`. `config.ts:431`
- `resolveConfig` reads no environment itself: the caller passes `{ port }`. `config.ts:378`
- `resolveConfig` reads only the known keys; unknown keys are dropped without a warning. `config.ts:407`
- `DEV_STRATEGIES` is `hmr`, `remount`, `reload`, `manual`; `DevStrategy` is derived from it. `config.ts:162`, `config.ts:165`
- `DevStrategy` is exported from `@dropletsjs/droplets` as a type; `DEV_STRATEGIES` is not exported. `../index.ts:6`
- `dev.strategy` defaults to `hmr`; any other value than `DEV_STRATEGIES` throws. `config.ts:437`, `config.ts:438`
- `dev.server.port` defaults to 5173; `PORT` wins over it. `config.ts:205`, `config.ts:442`
- `dev.injectTool` defaults to `false`. `config.ts:444`
- `config.ts` is Node-free: it imports only `hono/cors` types and `../runtime/web-url.ts`. `config.ts:1`, `config.ts:2`
- Config file candidates, in order: `droplets.config.ts`, `.mts`, `.js`, `.mjs`. `load-config.ts:10`
- Config file named by `configFile` that does not exist throws `config file not found`. `load-config.ts:29`
- Config file is loaded with Vite's `loadConfigFromFile`, so TypeScript and imports work and a function default export is called with Vite's `ConfigEnv`. `load-config.ts:51`
- Config file's imports are returned as `dependencies`, for the dev server to restart on change. `load-config.ts:54`
- `loadDropletsConfig` writes `.droplets/tsconfig.json` (through `vite/sync-types.ts`) before it loads the file. `load-config.ts:45`
- `loadDropletsConfig` reads `PORT` from `process.env` and passes it to both `resolveConfig` and `resolveDevConfig`. `load-config.ts:58`, `load-config.ts:59`
- Droplet discovery scans only the immediate subfolders of the droplets folder. `discover.ts:207`, `fs.ts:61`
- Droplet id is the folder name itself; a droplet folder's name must match `^[a-z0-9]+(-[a-z0-9]+)*$` (lowercase kebab-case). `discover.ts:70`, `discover.ts:74`
- Droplet folder whose name is not lowercase kebab-case is ignored (`ProductCard/` never becomes `product-card`). `discover.ts:211`
- Ignored droplet folders (those holding a `+droplet.*` component) are listed in one warning, `These droplet folders do not match the naming convention (lowercase kebab-case) and are ignored: …`, once per folder for the process, in `vite build` and `vite dev`. `discover.ts:213`, `discover.ts:256`
- Droplet component file matches `^\+[Dd]roplet(\..+)$`; the error page `^\+[Ee]rror(\..+)$`. `discover.ts:84`
- Droplet component suffixes never taken as a component (`CORE_SUFFIXES`): `.ts`, `.js`, `.server.ts`, `.server.js`, `.d.ts`. `../renderer.ts:606`, `discover.ts:87`
- Droplet folder with no component is skipped without a word. `discover.ts:220`
- Droplet folder with two components throws `has 2 droplet components … keep one`. `discover.ts:161`
- Droplet component suffix no renderer claims throws, naming the renderer to install when the suffix is a known one. `discover.ts:166`
- Droplet renderer is picked among those sharing the suffix by the component's imports. `discover.ts:169`
- Droplet folder that cannot be read holds no component. `discover.ts:98`
- Droplet list is returned sorted by id. `discover.ts:261`
- Droplet `hasLoad` is true only for `+droplet.ts`; `hasServerLoad` only for `+droplet.server.ts` (`.js` spellings are not looked for). `discover.ts:247`, `discover.ts:248`
- Flags are read from the component file only: the renderer's `readFlags`, else `readExportedFlags` on the component's source. `discover.ts:171`, `discover.ts:179`
- Flags in `+droplet.ts` or `+droplet.server.ts` are never read: discovery opens no other file for flags. `discover.ts:168`
- Flag defaults: `ssr` true, `hydrate` true, `prerender` false. `../renderer.ts:597`
- Flags an `+error.*` declares are ignored: the error page follows the droplet's flags. `discover.ts:191`
- An error page in another framework warns once per file in build and dev; the flags an error page declares warn in dev only, once per file. `discover.ts:110`, `discover.ts:143`, `discover.ts:182`
- Error page is looked for only among files the droplet's renderer handles; another framework's is ignored. `discover.ts:146`
- Error page next to a script droplet is ignored, with a dev warning. `discover.ts:226`
- `shipsClient` is true unless `hydrate` is `false`. `discover.ts:78`
- Flags parser reads with Vite's `parseAst`, not a text scan: a flag in a comment or a string is no flag. `flags.ts:7`, `flags.ts:40`
- Flags parser language comes from the extension (`js`, `jsx`, `ts`, `tsx`, with `c`/`m` variants); anything else parses as TSX. `flags.ts:33`
- Flags source that does not parse declares no flags; its compiler reports it. `flags.ts:43`, `flags.ts:176`
- Flags count only as top-level `export const <name> = <literal>`; `let`, `function`, `export { x as ssr }` and destructuring hold no value. `flags.ts:92`, `flags.ts:98`, `flags.ts:105`
- Flags parser skips `export type` and `declare` exports. `flags.ts:86`, `flags.ts:89`
- `ssr` and `prerender` take a boolean literal; any other value or form warns `must be a literal true or false; ignoring it` and keeps the default. `flags.ts:126`, `flags.ts:127`
- `hydrate` takes `true`, `false`, `"visible"` or `"interactive"`; anything else warns and keeps the default. `flags.ts:138`, `flags.ts:139`
- `readExportedFlag`, `readExportedHydrate` and `readExportedFlags` are exported from `@dropletsjs/droplets/vite` for renderers; `readFlagExports` lists every flag export with its literal, if one, and how it is written, warning about nothing, for the script renderer. `../vite.ts:14`, `flags.ts:202`
- Env declaration files: `src/env.ts`, then `src/env.js`. `env.ts:7`
- Env values are every variable Vite's `loadEnv` sees for the mode (`.env` files and `process.env`), with no prefix filter. `env.ts:46`
- Env declaration is loaded with Vite's `runnerImport`; it and its imports are returned as `dependencies`. `env.ts:50`, `env.ts:64`
- Env declaration file must export `variables` as an object, else loading throws. `env.ts:57`
- Env variable names must match `^[A-Za-z_][A-Za-z0-9_]*$`, each with an options object. `../env.ts:59`, `../env.ts:68`
- `$droplets/env/public` holds `public: true` variables: `static` ones inlined, the rest getters. `env.ts:90`, `env.ts:92`
- `$droplets/env/public` in the browser reads runtime variables from this server's record on `globalThis[Symbol.for("droplets.servers")]`. `env.ts:99`
- `$droplets/env/public` and `$droplets/env/private` on the server read runtime variables through `readRuntimeEnv` of `runtime/env-store`. `env.ts:100`, `env.ts:117`
- `$droplets/env/private` holds the non-public variables and has no browser form. `env.ts:108`, `env.ts:110`
- `$droplets/env/*` objects are frozen. `env.ts:101`, `env.ts:118`
- `missingStatic` lists static variables without a value. `env.ts:69`
- API route files: `+server.ts` and `+server.js` only. `api-routes.ts:15`
- API routes live under `/api`; `<apiFolder>/+server.ts` answers `/api`. `api-routes.ts:18`, `api-routes.ts:69`
- API route folder `(group)` adds nothing to the URL. `api-routes.ts:33`
- API route folder `[name]` is a param, `[...name]` a rest param; names match `[A-Za-z_$][\w$]*`. `api-routes.ts:35`, `api-routes.ts:38`
- API route folder with any other bracket (`[[x]]`, matchers) throws `unsupported route segment`. `api-routes.ts:41`
- API route with a repeated param name throws. `api-routes.ts:57`
- API route with a segment after `[...rest]` throws. `api-routes.ts:62`
- API routes of the same shape (`a/[id]` and `a/[slug]`) throw `both answer`. `api-routes.ts:105`
- API routes are sorted most specific first by `compareRoutes`, then by id. `api-routes.ts:112`
- API folder that is missing or unreadable yields no routes. `api-routes.ts:78`
- Logger levels: `error`, `warn`, `info`, `debug`; default `info`. `logger.ts:13`, `logger.ts:20`
- `DEV_DROPLETS_LOG` is read once, on the first message (not when the module loads), guarded for runtimes without `process`. `logger.ts:33`, `logger.ts:41`
- `DEV_DROPLETS_LOG` is case-insensitive; an unknown value falls back to `info`. `logger.ts:28`, `logger.ts:29`
- Logger has no top-level work, so it tree-shakes out of a bundle that never calls it. `logger.ts:32`
- Logger messages print through `console[level]` with the prefix `[droplets:<source>]`, source `framework` or `drop`. `logger.ts:11`, `logger.ts:47`
- `setLogLevel` changes the level for the process; `logger` and `setLogLevel` are exported from `@dropletsjs/droplets/vite` for adapters and plugins at build time. `logger.ts:36`, `../vite.ts:16`
- `logger.ts` is Node-free: it touches `process` only behind `typeof process`. `logger.ts:25`
- Package root is found by walking up from the compiled module to the nearest `package.json`. `paths.ts:9`, `paths.ts:22`
- Paths into `dist/`: `runtime/entry-client.js`, `entry-server.js`, `server.js`, `props.js`, `load.js`, `env-store.js`, `request-store.js`, `form.js`, `enhance.js`, `server-records.js`, `client-init.js`. `paths.ts:31`, `paths.ts:56`
- Paths into `dist/` all name tsdown entries, so their names stay fixed. `../../tsdown.config.ts:12`, `../../tsdown.config.ts:16`
- `toViteFsPath` turns an absolute path into `/@fs/<path>` with forward slashes. `paths.ts:60`
- `connect({ file, workerData })` starts `file` in a worker thread that shares `process.env`; `call(method, ...args)` is answered by the thread's named handler, `request(url, init)` as a `Response`; a thread error rejects every call. `app-thread.ts:79`, `app-thread.ts:80`
- `answer(handlers)` runs in the thread: a call reaches a handler through `Object.hasOwn`, an unknown name or a throw answers the error's message. `app-thread.ts:23`
- Requests cross the thread as `{ url, method, headers, body }` with a text body (a `URLSearchParams` is its string; another body is dropped); responses as `{ status, headers, body }`. `app-thread.ts:40`, `app-thread.ts:52`
- `fileExists` is true for files only; a missing or unreadable path is false. `fs.ts:22`, `fs.ts:25`
- `loadTextFile` returns `null` for a missing file and throws any other read error. `fs.ts:34`, `fs.ts:35`
- `loadJsonFile` returns `null` for a missing or malformed file. `fs.ts:48`, `fs.ts:53`
- `loadDirectoryNames` returns `[]` for a missing or unreadable folder. `fs.ts:64`

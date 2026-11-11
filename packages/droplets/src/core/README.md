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
| `logger.ts` | `logger`, `setLogLevel`, `DROPLETS_LOG` | anywhere (on the portability list) |
| `load-config.ts` | finds and loads `droplets.config.*` through Vite, then resolves it | Node, build and dev |
| `discover.ts` | scans the droplets folder: ids, component files, renderers, flags, load files, error pages | Node, build and dev |
| `flags.ts` | parses `ssr`, `hydrate`, `prerender` out of a component's source | build and dev (parses with Vite) |
| `env.ts` | loads `src/env.ts` and `.env` values; generates `$droplets/env/public` and `$droplets/env/private` | Node, build and dev |
| `api-routes.ts` | scans the API folder for `+server.ts` and turns folders into route segments | Node, build and dev |
| `paths.ts` | absolute paths of the compiled runtime files in this package's `dist/` | Node, build and dev |
| `fs.ts` | small `node:fs` helpers: missing files read as `null` or `false` | Node |

### Config

`droplets.config.ts` (or `.mts`, `.js`, `.mjs`) default-exports a plain
object; `config()` from `@dropletsjs/droplets` only adds types. The plugin
loads it with Vite's `loadConfigFromFile`, then `resolveConfig` fills in the
defaults and validates; `resolveDevConfig` resolves `dev` apart, so a
production server never carries it.

| Key | Default | Validation |
|---|---|---|
| `dropletsFolder`, `apiFolder` | `src/droplets`, `src/api` | normalised: `\` to `/`, `.` and empty segments dropped, `..` pops one |
| `health` | `/health` | starts with `/`; no `?`, `#`, whitespace; not `/`, `/index.js`, `/index.css`, nor under `/droplets`, `/assets`, `/api` |
| `importMap` | `/importmap`, only when the client build has externals | same path rules; `health` may not equal it or `<importMap>.js` |
| `index` | absent: root `index.html` or a placeholder | kept as given |
| `element` | `djs-droplet` | `^[a-z][a-z0-9._]*-[a-z0-9._-]*$` |
| `cors` | off | `true` becomes `{ origin: "*" }`, an object passes through |
| `origin` | `[]` | each `"*"` or an `http(s)` location with an optional path prefix |
| `trustedOrigins` | `[]` | an array; each `"*"` or a bare origin, no path |
| `fragmentCacheControl` | `private, no-store` | non-empty, no CR/LF, trimmed; `false` sends none |
| `csrf.checkOrigin`, `warnImportMap` | `true` | |
| `limits` | json 1 MB, form 1 MB, multipart 10 MB, props 8 KB | each a positive number; `Infinity` lifts it |
| `server.port` | `8000` | `PORT` wins |
| `dev.server.port` | `5173` | `PORT` wins |
| `dev.strategy` | `"hmr"` | one of `DEV_STRATEGIES` |
| `dev.injectTool` | `false` | |

`"*"` in `origin` or `trustedOrigins` is accepted, never refused; the
warning it earns is the runtime's (`runtime/security.ts`). `DROPLETS_ORIGIN`
and `DROPLETS_TRUSTED_ORIGINS` are not read here: the runtime adds them per
request through `normalizeOrigin` and `normalizeTrustedOrigins`.

### Discovery and flags

A droplet is an immediate subfolder of `dropletsFolder` holding one
`+droplet.<suffix>` (or `+Droplet.<suffix>`). Its id is the folder name in
kebab case. The renderer is the one that claims the suffix; when several
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

- `DropletsConfig` is the shape of `droplets.config.ts`'s default export; `config()` returns its argument unchanged. `config.ts:11`, `config.ts:196`
- `DEFAULTS` holds every default: folders, `health`, `importMap`, `element`, ports, `limits`, `fragmentCacheControl`. `config.ts:180`
- `dropletsFolder` defaults to `src/droplets`. `config.ts:181`
- `apiFolder` defaults to `src/api`. `config.ts:182`
- `dropletsFolder` and `apiFolder` normalisation: `\` becomes `/`, empty and `.` segments drop, `..` pops a segment. `config.ts:223`
- `dropletsFolder` normalisation drops a leading `..` silently: `../elsewhere` becomes `elsewhere`. `config.ts:226`
- `dropletsFolder` that normalises to nothing falls back to the default. `config.ts:231`
- `health` defaults to `/health`; `false` turns it off. `config.ts:183`, `config.ts:352`
- `health` and `importMap` paths must start with `/` and hold no `?`, `#` or whitespace, else `resolveConfig` throws. `config.ts:241`
- `health` and `importMap` may not be `/`, `/index.js`, `/index.css` or under `/droplets`, `/assets`, `/api`. `config.ts:235`, `config.ts:236`
- `health` equal to `importMap` or to `<importMap>.js` throws. `config.ts:360`
- `importMap` defaults to `/importmap`; `auto` is true only when the key is unset (served only when the client build has externals). `config.ts:184`, `config.ts:358`
- `importMap: false` turns the import map routes off. `config.ts:354`
- `index` is kept as given; absent, the resolved config has no `index` key. `config.ts:370`
- `element` defaults to `djs-droplet`. `config.ts:185`
- `element` must match `^[a-z][a-z0-9._]*-[a-z0-9._-]*$`, else `resolveConfig` throws. `config.ts:254`, `config.ts:344`
- `isValidElementName` is the same check, exported from `@dropletsjs/droplets`. `config.ts:256`, `../index.ts:1`
- `cors: true` resolves to `{ origin: "*" }`; an object passes through; anything else leaves `cors` unset. `config.ts:349`
- `origin` accepts a string or a list; anything else throws. `config.ts:301`
- `origin` entry `"*"` is kept as is: trust settings accept it, never refuse. `config.ts:303`
- `origin` entries are `http:` or `https:` URLs only. `config.ts:291`
- `origin` entries refuse credentials and a `*` in the hostname (`https://*.example`). `config.ts:293`
- `origin` entries refuse `\`, `#` and `?`. `config.ts:284`
- `origin` entry with a path keeps it as a prefix, trailing slashes trimmed, when `isLocationPrefix` accepts it. `config.ts:295`
- `isLocationPrefix` takes a prefix that starts with `/`, is at most 256 characters, and has no `//`, `\`, `..`, `?`, `#` or control character. `../runtime/web-url.ts:46`
- `origin` entry with the path `/` resolves to the bare origin. `config.ts:294`
- `trustedOrigins` must be an array, else `resolveConfig` throws. `config.ts:263`
- `trustedOrigins` entry `"*"` is kept as is. `config.ts:267`
- `trustedOrigins` entries are bare origins (no path), resolved to `scheme://host[:port]`. `config.ts:275`, `config.ts:278`
- `DROPLETS_ORIGIN` is not read in core: the runtime parses it per request with `normalizeOrigin`, warning about and skipping bad entries. `../runtime/security.ts:99`
- `DROPLETS_TRUSTED_ORIGINS` is not read in core: the runtime parses it per request with `normalizeTrustedOrigins`, warning about and skipping bad entries. `../runtime/security.ts:68`
- `"*"` warning (`trusts any forwarded location`) is logged by the runtime, not by core. `../runtime/security.ts:54`
- `fragmentCacheControl` defaults to `private, no-store`; `false` sends none. `config.ts:189`, `config.ts:315`
- `fragmentCacheControl` must be a non-empty string without CR or LF; it is trimmed. `config.ts:316`, `config.ts:321`
- `csrf.checkOrigin` defaults to `true`. `config.ts:378`
- `warnImportMap` defaults to `true`. `config.ts:373`
- `limits` defaults: json 1 MB, form 1 MB, multipart 10 MB, props 8 KB. `config.ts:188`
- `limits` values must be numbers greater than 0, else `resolveConfig` throws; `Infinity` passes. `config.ts:327`
- `server.port` defaults to 8000. `config.ts:187`
- `PORT` is converted with `Number()`; empty, `0` or not a number counts as unset. `config.ts:348`
- `PORT` wins over `server.port`. `config.ts:380`
- `resolveConfig` reads no environment itself: the caller passes `{ port }`. `config.ts:340`
- `resolveConfig` reads only the known keys; unknown keys are dropped without a warning. `config.ts:366`
- `DEV_STRATEGIES` is `hmr`, `remount`, `reload`, `manual`; `DevStrategy` is derived from it. `config.ts:146`, `config.ts:149`
- `DEV_STRATEGIES` and `DevStrategy` are exported from `@dropletsjs/droplets`. `../index.ts:1`
- `dev.strategy` defaults to `hmr`; any other value than `DEV_STRATEGIES` throws. `config.ts:386`, `config.ts:387`
- `dev.server.port` defaults to 5173; `PORT` wins over it. `config.ts:186`, `config.ts:391`
- `dev.injectTool` defaults to `false`. `config.ts:393`
- `config.ts` is Node-free: it imports only `hono/cors` types and `../runtime/web-url.ts`. `config.ts:1`, `config.ts:2`
- Config file candidates, in order: `droplets.config.ts`, `.mts`, `.js`, `.mjs`. `load-config.ts:10`
- Config file named by `configFile` that does not exist throws `config file not found`. `load-config.ts:29`
- Config file is loaded with Vite's `loadConfigFromFile`, so TypeScript and imports work and a function default export is called with Vite's `ConfigEnv`. `load-config.ts:51`
- Config file's imports are returned as `dependencies`, for the dev server to restart on change. `load-config.ts:54`
- `loadDropletsConfig` writes `.droplets/tsconfig.json` (through `vite/sync-types.ts`) before it loads the file. `load-config.ts:45`
- `loadDropletsConfig` reads `PORT` from `process.env` and passes it to both `resolveConfig` and `resolveDevConfig`. `load-config.ts:58`, `load-config.ts:59`
- Droplet discovery scans only the immediate subfolders of the droplets folder. `discover.ts:205`, `fs.ts:61`
- Droplet id is the folder name in kebab case (`HelloWorld` → `hello-world`). `discover.ts:72`
- Droplet component file matches `^\+[Dd]roplet(\..+)$`; the error page `^\+[Ee]rror(\..+)$`. `discover.ts:82`
- Droplet component suffixes never taken as a component (`CORE_SUFFIXES`): `.ts`, `.js`, `.server.ts`, `.server.js`, `.d.ts`. `../renderer.ts:606`, `discover.ts:85`
- Droplet folder with no component is skipped without a word. `discover.ts:210`
- Droplet folder with two components throws `has 2 droplet components … keep one`. `discover.ts:159`
- Droplet component suffix no renderer claims throws, naming the renderer to install when the suffix is a known one. `discover.ts:164`
- Droplet renderer is picked among those sharing the suffix by the component's imports. `discover.ts:167`
- Droplet folder that cannot be read holds no component. `discover.ts:96`
- Droplet ids that collide: a warning `duplicate droplet id; skipping folder`, the later folder in `readdir` order is skipped (unsorted). `discover.ts:212`, `fs.ts:61`
- Droplet list is returned sorted by id. `discover.ts:251`
- Droplet `hasLoad` is true only for `+droplet.ts`; `hasServerLoad` only for `+droplet.server.ts` (`.js` spellings are not looked for). `discover.ts:243`, `discover.ts:244`
- Flags are read from the component file only: the renderer's `readFlags`, else `readExportedFlags` on the component's source. `discover.ts:169`, `discover.ts:177`
- Flags in `+droplet.ts` or `+droplet.server.ts` are never read: discovery opens no other file for flags. `discover.ts:166`
- Flag defaults: `ssr` true, `hydrate` true, `prerender` false. `../renderer.ts:597`
- Flags an `+error.*` declares are ignored: the error page follows the droplet's flags. `discover.ts:189`
- Error page flags and an error page in another framework warn in dev only, once per file and reason. `discover.ts:109`, `discover.ts:180`
- Error page is looked for only among files the droplet's renderer handles; another framework's is ignored. `discover.ts:144`
- Error page next to a script droplet is ignored, with a dev warning. `discover.ts:223`
- `shipsClient` is true unless `hydrate` is `false`. `discover.ts:76`
- Flags parser reads with Vite's `parseAst`, not a text scan: a flag in a comment or a string is no flag. `flags.ts:7`, `flags.ts:40`
- Flags parser language comes from the extension (`js`, `jsx`, `ts`, `tsx`, with `c`/`m` variants); anything else parses as TSX. `flags.ts:33`
- Flags source that does not parse declares no flags; its compiler reports it. `flags.ts:43`, `flags.ts:176`
- Flags count only as top-level `export const <name> = <literal>`; `let`, `function`, `export { x as ssr }` and destructuring hold no value. `flags.ts:92`, `flags.ts:98`, `flags.ts:105`
- Flags parser skips `export type` and `declare` exports. `flags.ts:86`, `flags.ts:89`
- `ssr` and `prerender` take a boolean literal; any other value or form warns `must be a literal true or false; ignoring it` and keeps the default. `flags.ts:126`, `flags.ts:127`
- `hydrate` takes `true`, `false`, `"visible"` or `"interactive"`; anything else warns and keeps the default. `flags.ts:138`, `flags.ts:139`
- `readExportedFlag`, `readExportedHydrate` and `readExportedFlags` are exported from `@dropletsjs/droplets/vite` for renderers. `../vite.ts:14`
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
- Logger levels: `error`, `warn`, `info`, `debug`; default `info`. `logger.ts:6`, `logger.ts:13`
- `DROPLETS_LOG` is read once, when the logger module loads, guarded for runtimes without `process`. `logger.ts:25`
- `DROPLETS_LOG` is case-insensitive; an unknown value falls back to `info`. `logger.ts:21`, `logger.ts:22`
- Logger messages print through `console[level]` with the prefix `[droplets:<source>]`, source `framework` or `drop`. `logger.ts:4`, `logger.ts:38`
- `setLogLevel` changes the level for the process. `logger.ts:28`
- `logger.ts` is Node-free: it touches `process` only behind `typeof process`. `logger.ts:25`
- Package root is found by walking up from the compiled module to the nearest `package.json`. `paths.ts:9`, `paths.ts:22`
- Paths into `dist/`: `runtime/entry-client.js`, `entry-server.js`, `server.js`, `props.js`, `load.js`, `env-store.js`, `request-store.js`, `form.js`, `enhance.js`, `server-records.js`, `client-init.js`. `paths.ts:31`, `paths.ts:53`
- Paths into `dist/` all name tsdown entries, so their names stay fixed. `../../tsdown.config.ts:12`, `../../tsdown.config.ts:16`
- `toViteFsPath` turns an absolute path into `/@fs/<path>` with forward slashes. `paths.ts:57`
- `fileExists` is true for files only; a missing or unreadable path is false. `fs.ts:22`, `fs.ts:25`
- `loadTextFile` returns `null` for a missing file and throws any other read error. `fs.ts:34`, `fs.ts:35`
- `loadJsonFile` returns `null` for a missing or malformed file. `fs.ts:48`, `fs.ts:53`
- `loadDirectoryNames` returns `[]` for a missing or unreadable folder. `fs.ts:64`

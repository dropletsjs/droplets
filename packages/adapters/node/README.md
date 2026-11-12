# @dropletsjs/adapter-node

The Node adapter for [Droplets](../../droplets). With it, `vite build` writes
`dist/server.js`: a production server you start with `node`, or import and
mount in your own Node server for its `{ fetch }` handler. `vite preview`
serves the build through the same code.

```bash
pnpm add -D @dropletsjs/adapter-node@alpha
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { node } from "@dropletsjs/adapter-node";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [svelte()] })],
});
```

```bash
vite build
PORT=8000 node dist/server.js
```

## Details

### Options

`node()` takes no options. The listen port comes from `droplets.config.ts`
(`server: { port }`, default `8000`), and the `PORT` environment variable
overrides it when the server starts.

### What `vite build` writes

| Path | What it is |
|---|---|
| `dist/server.js` | the server: this package's `entry.ts` with Hono, `@hono/node-server`, the framework and your `droplets.config.ts` bundled in; it imports only `node:*` modules |
| `dist/server/entry-server.js` | the SSR bundle (your droplets, hooks and `+server.ts` routes); your own dependencies stay external, so `node_modules` must be present at runtime |
| `dist/server/_prerendered/` | prerendered renders; server-only, never served |
| `dist/client/` | the browser build and `droplets.json`, read from disk per request |
| `dist/client/assets/public/` | a copy of your `public/` folder, served at `/assets/public/` |

`dist/server.js` finds `client/` and `server/` next to itself, not in the
working directory, so `node /srv/app/dist/server.js` works from anywhere.
Ship the whole `dist/` folder.

### How the server starts

- `node dist/server.js` listens, as does `node dist/server` without the
  extension or a symlink to the file: the file Node was given and this
  module are compared as real paths.
- Importing `dist/server.js` does not listen. Its default export is
  `{ fetch }`, a `Request => Promise<Response>` handler for Express, Fastify
  or any server that speaks the Fetch API.
- `runServer()`, a named export of `dist/server.js`, starts listening when
  you import the file.
- The app is created on the first request (or by `runServer()`), once per
  process: the SSR bundle is imported and `droplets.json` read at that
  moment.
- It listens on every interface (no hostname is passed) and logs
  `server listening on http://localhost:<port>`.

`createNodeServerApp(paths, config)` is exported for a host that wants the
Hono app itself. `paths` is `{ clientRoot, ssrEntryUrl, serverRoot? }`
(`ssrEntryUrl` is a `file:` URL; `serverRoot` defaults to `server` next to
`clientRoot`); `config` is `resolveConfig(...)` from `@dropletsjs/droplets`.

### Environment

The config is bundled at build time: `droplets.config.ts` is not read at
runtime. What is read from `process.env` at runtime: `PORT` (once, at
startup), `DROPLETS_SECRET`, `DROPLETS_TRUSTED_ORIGINS`, `DROPLETS_ENV_MAX_AGE`
and your own private variables. It logs errors only, with `console.error`. See
[Deployment](https://dropletsjs.dev/guides/deployment/).

### Static files

Only `/assets/*` is served from disk, out of `dist/client/assets`. A path
that resolves outside that folder, a missing file and a directory all answer
`404 Not Found` as text, with `cache-control: no-store` (the file may be
there after the next build). `handle` from your hooks never runs for these
files.

- Every file Vite emits there is content-hashed: `cache-control: public,
  max-age=2592000, immutable`.
- Every file answered carries `x-content-type-options: nosniff` with its
  content type, from a table of the common script, style, data, text, image,
  font, WebAssembly, document, archive, video and audio extensions (text
  types with `; charset=utf-8`); any other extension is
  `application/octet-stream`. A browser takes it for what the type says and
  nothing else.
- Your `public/` folder is copied to `dist/client/assets/public/` and served
  at `/assets/public/<file>`. Those names do not change between builds, so
  they are revalidated on every use by default: `cache-control: no-cache` (`publicCacheControl`), an `ETag`
  (SHA-1 of the file), and `304` when `If-None-Match` matches.
- Nothing else in `dist/client` is a file route: `/robots.txt` answers 404,
  even when `public/robots.txt` exists.

### `droplets.json`

Read on the first request and kept for the life of the process once it has
loaded. When it is missing, the server logs
`droplets.json not found at <path>; did you build?`; when it is not valid
JSON, `<path> is not valid JSON: <parse error>; did the build finish?`. Either
way it answers with an empty manifest and reads the file again on the next
request, so a build that finishes later is picked up without a restart; each
failure is logged once, not per request, until a load succeeds.

### Preview

`vite preview` runs `createNodeServerApp` over `dist/client` and
`dist/server/entry-server.js` of the build, with the config the plugin
loaded.

### Changing this package

`pnpm --filter @dropletsjs/adapter-node build` runs the tests, then
tsdown. The tests build the framework's own fixture
(`packages/droplets/test/fixtures/app`), so `@dropletsjs/droplets` must be
built first. `entry.ts` is a tsdown entry: `node()` finds `dist/entry.js`
by path.

## Facts

- `node()` takes no options and returns the adapter named `node`. `src/index.ts:23`
- `node()` serverEntry is `dist/entry.js` of this package, found by path. `src/index.ts:26`
- `node()` serverFile: `vite build` writes the server as `dist/server.js`. `src/index.ts:27`
- `node()` separateSsrBundle is true: the SSR bundle is its own file, `dist/server/entry-server.js`. `src/index.ts:28`, `../../droplets/src/vite/build.ts:163`
- `node()` noExternal bundles `@hono/node-server` and `@dropletsjs/adapter-node` into `dist/server.js`. `src/index.ts:29`
- Server bundle always bundles `hono`, `case-anything`, `@dropletsjs/droplets` and `@dropletsjs/renderer-*`; `dist/server.js` imports only `node:*`. `../../droplets/src/vite/build.ts:59`, `test/index.test.ts:25`
- `vite preview` calls `node().preview`, which serves `dist/client` and `dist/server/entry-server.js` through `createNodeServerApp`. `src/index.ts:30`, `../../droplets/src/vite/plugin.ts:531`
- `dist/server.js` resolves `client/` and `server/entry-server.js` relative to its own file, not the working directory. `src/entry.ts:10`
- `droplets.config.ts` is bundled into `dist/server.js` through `virtual:droplets-config`; it is not read at runtime. `src/entry.ts:4`, `test/index.test.ts:27`
- `PORT` is read once at startup and overrides `server.port` from the config. `src/entry.ts:17`, `../../droplets/src/core/config.ts:408`
- `PORT` is converted with `Number()`; empty, `0` or not a number falls back to `server.port`, then 8000. `../../droplets/src/core/config.ts:374`
- `server.port` defaults to 8000. `../../droplets/src/core/config.ts:205`
- Listening starts when `process.argv[1]` names this file: as given, with `.js` or `.mjs` added, or through a symlink, compared as real paths (`isMainModule`). `src/entry.ts:44`, `src/main-module.ts:27`
- Listening does not start for another file, a missing one, or no argument. `src/main-module.ts:28`, `test/main-module.test.ts:34`
- Importing `dist/server.js` does not listen; the default export is `{ fetch }`. `src/entry.ts:35`
- `runServer()` is exported from `dist/server.js` and starts listening. `src/entry.ts:27`
- Listen hostname is not set: `@hono/node-server` listens on Node's default, every interface. `src/entry.ts:31`
- Listening logs nothing: a production server logs errors only. `src/entry.ts:31`
- App creation is lazy and once per process: the first request or `runServer()` creates it, later calls reuse the same promise. `src/entry.ts:22`
- App creation that fails stays cached: every later request gets the same rejection. `src/entry.ts:22`
- `createNodeServerApp(paths, config)` is exported from the package and returns the Hono app. `src/index.ts:6`, `src/app.ts:22`
- `createNodeServerApp` imports the SSR bundle from `paths.ssrEntryUrl`, a `file:` URL. `src/app.ts:24`
- `createNodeServerApp` reads `droplets.json` before it returns: `buildHash` is `__hash`, `externals` is `__externals`. `src/app.ts:26`, `src/app.ts:32`, `src/app.ts:40`
- `serverRoot` defaults to `server` next to `clientRoot`. `src/assets.ts:40`
- Prerendered renders are read from `<serverRoot>/_prerendered`. `src/assets.ts:43`
- `droplets.json` is read from `<clientRoot>/droplets.json` on the first request; only a manifest that loaded is cached. `src/assets.ts:44`, `src/assets.ts:62`
- `droplets.json` missing: `console.error` `droplets.json not found at <path>; did you build?`, and the fallback manifest. `src/assets.ts:67`
- `droplets.json` malformed: `console.error` `<path> is not valid JSON: <parse error>; did the build finish?`, and the fallback manifest. `src/assets.ts:71`, `src/fs.ts:43`
- `droplets.json` fallback is never cached: the next request reads the file again, so a build after startup needs no restart. `src/assets.ts:66`, `src/assets.ts:70`, `test/assets.test.ts:90`
- `droplets.json` failure is logged once per failure, not per request: a different failure logs again, a load that succeeds resets it. `src/assets.ts:49`, `test/assets.test.ts:98`
- Droplet lookup in the manifest uses `Object.hasOwn`: `__proto__` and other prototype names find nothing. `src/assets.ts:62`, `test/assets.test.ts:57`
- Client bundles, `/index.js` and the global CSS are read from disk per request, not cached. `src/assets.ts:71`, `src/assets.ts:75`, `src/assets.ts:83`
- File read errors other than ENOENT are thrown, not turned into null. `src/fs.ts:31`
- `loadJsonFile` throws `MalformedJsonError` (`name`, `path`, `cause`: the `SyntaxError`) for a file that does not parse; a missing file is `null`. `src/fs.ts:12`, `src/fs.ts:43`
- `/assets/*` is the only route that serves files from `dist/client`. `../../droplets/src/server/app.ts:125`
- `/assets/*` and `/index.js` never pass through `handle`. `../../droplets/src/runtime/app.ts:338`, `../../droplets/src/runtime/app.ts:900`
- `/assets/*` serves from `dist/client/assets`. `src/static.ts:48`
- `/assets/*` path resolving outside `dist/client/assets` answers the text `404 Not Found` with `cache-control: no-store` before any read. `src/static.ts:64`, `src/static.ts:98`
- `/assets/*` missing file or directory answers the text `404 Not Found` with `cache-control: no-store`, the same answer as the Cloudflare adapter's. `src/static.ts:106`, `test/static.test.ts:111`
- `/assets/*` cache-control for hashed files is `public, max-age=2592000, immutable` (30 days). `src/static.ts:70`
- `/assets/*` content type comes from a fixed extension table, case-insensitive: scripts, styles, JSON, source maps, web manifests, HTML, XML, text, Markdown, CSV, WebVTT, iCalendar and YAML with `; charset=utf-8`; the image, font, WebAssembly, PDF, ZIP, gzip, video and audio types without; any other extension is `application/octet-stream`. `src/static.ts:6`, `src/static.ts:72`, `test/static.test.ts:47`
- `/assets/*` sends `x-content-type-options: nosniff` on every file answered, hashed and `public/` alike. `src/static.ts:69`, `test/static.test.ts:32`
- `/assets/*` reads the whole file into memory per request: no streaming, no range requests. `src/static.ts:63`
- `public/` is copied into `dist/client/assets/public/` only; Vite's own `copyPublicDir` is off. `../../droplets/src/vite/build.ts:137`, `../../droplets/src/vite/assets.ts:95`
- `/assets/public/*` cache-control is `publicCacheControl` from the config (`no-cache` by default, none for `false`), with an `ETag` of the file's SHA-1 in base64url. `src/app.ts:41`, `src/static.ts:73`, `src/static.ts:74`
- `/assets/public/*` answers `304` with no body when any `If-None-Match` tag equals the `ETag`. `src/static.ts:76`
- `/assets/public/*` is the only path with an `ETag`; hashed files never revalidate. `src/static.ts:69`, `test/static.test.ts:61`
- `public/robots.txt` is not served at `/robots.txt`: it answers 404. `test/app.test.ts:126`
- Runtime env comes from `process.env`: `DROPLETS_SECRET`, `DROPLETS_TRUSTED_ORIGINS`, `DROPLETS_ENV_MAX_AGE` and private variables, per read. `../../droplets/src/runtime/env-store.ts:26`
- Node engine is `>=22`. `package.json:35`
- Build script runs the tests before tsdown. `package.json:38`
- Tests build the framework's fixture app and fail when `@dropletsjs/droplets` is not built. `test/build-fixture.ts:19`
- A droplet without stylesheets has no `style.css` (404), and `/index.css` answers 404 without a shared stylesheet: its stub is not written then. `../../droplets/src/runtime/app.ts:1162`, `test/app.test.ts:187`

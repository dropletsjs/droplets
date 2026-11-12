# @dropletsjs/adapter-bun

The Bun adapter for [Droplets](../../droplets). With it, `vite build` writes
`dist/server.js`: a production server that `bun dist/server.js` serves, or
that you import for its `fetch` handler. The app is the
[Node adapter](../node)'s, running on Bun's `node:` modules.

```bash
bun add -d @dropletsjs/adapter-bun@alpha
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { bun } from "@dropletsjs/adapter-bun";

export default defineConfig({
  plugins: [droplets({ adapter: bun(), renderers: [svelte()] })],
});
```

```bash
bun run build
PORT=8000 bun dist/server.js
```

## Details

### Options

`bun()` takes no options. The listen port comes from `droplets.config.ts`
(`server: { port }`, default `8000`), and the `PORT` environment variable
overrides it when the server starts.

### What `vite build` writes

The same layout as the Node adapter: `dist/server.js` (this package's
`entry.ts` with the Node adapter, Hono and the framework bundled in; it
imports only `node:*` modules), `dist/server/entry-server.js` (the SSR
bundle; your own dependencies stay external, so `node_modules` must be
present), `dist/server/_prerendered/` and `dist/client/`. Ship the whole
`dist/` folder.

### How the server starts

- `bun dist/server.js` serves the default export, `{ port, development:
  false, fetch }`, and logs `Started server: http://localhost:<port>`. That is
  Bun's own behaviour for the default export of the entry point.
- `development: false` keeps Bun's debug page away: errors answer with the
  droplet's error page.
- Importing `dist/server.js` does not listen; `default.fetch` is a
  `Request => Promise<Response>` handler for your own server.
- The app is created on the first request, once per process.

### Static files, `droplets.json`, environment

All from the Node adapter's `createNodeServerApp`: `/assets/*` from
`dist/client/assets` (hashed files immutable, `public/` under
`/assets/public/` revalidated), `droplets.json` read on the first request and
kept once it loads (read again while it is missing or malformed), and
`DROPLETS_SECRET`, `DROPLETS_TRUSTED_ORIGINS`, `DROPLETS_ENV_MAX_AGE` and your
private variables from the process environment. It logs errors only.
See its [README](../node/README.md) and
[Deployment](https://dropletsjs.dev/guides/deployment/).

### Preview

`vite preview` runs the Node adapter's `createNodeServerApp` over the build,
in Vite's own process.

### Changing this package

`pnpm --filter @dropletsjs/adapter-bun build` runs the tests, then tsdown.
The tests build the framework's own fixture, so `@dropletsjs/droplets` must
be built first. `test/entry.test.ts` runs the built server with Bun and is
skipped when no `bun` binary answers: set `BUN` (in the environment or the
root `.env.local`) for one off the `PATH`. `entry.ts` is a tsdown entry:
`bun()` finds `dist/entry.js` by path.

## Facts

- `bun()` takes no options and returns the adapter named `bun`. `src/index.ts:23`, `src/index.ts:25`
- `bun()` serverEntry is `dist/entry.js` of this package, found by path. `src/index.ts:26`
- `bun()` serverFile: `vite build` writes the server as `dist/server.js`. `src/index.ts:27`
- `bun()` separateSsrBundle is true: the SSR bundle is its own file, `dist/server/entry-server.js`. `src/index.ts:28`
- `bun()` noExternal bundles `@dropletsjs/adapter-node` and `@dropletsjs/adapter-bun` into `dist/server.js`. `src/index.ts:29`
- `dist/server.js` imports only `node:*` and holds no `@hono/node-server`. `test/index.test.ts:20`, `test/index.test.ts:21`
- `vite preview` serves `dist/client` and `dist/server/entry-server.js` through `createNodeServerApp` of `@dropletsjs/adapter-node`. `src/index.ts:30`
- `dist/server.js` resolves `client/` and `server/entry-server.js` relative to its own file, not the working directory. `src/entry.ts:9`
- `droplets.config.ts` is bundled into `dist/server.js` through `virtual:droplets-config`; it is not read at runtime. `src/entry.ts:3`
- `PORT` is read once at startup and overrides `server.port` from the config. `src/entry.ts:16`
- Default export of `dist/server.js` is `{ port, development, fetch }`. `src/entry.ts:27`
- Default export `port` is `server.port` of the config, after `PORT`. `src/entry.ts:28`
- Default export `development` is `false`: an error answers with the droplet's error page, not Bun's debug page. `src/entry.ts:30`, `test/entry.test.ts:75`
- `bun dist/server.js` listens and logs `Started server: http://localhost:<port>`. `test/entry.test.ts:51`
- Importing `dist/server.js` does not listen; `default.fetch` is a function. `test/entry.test.ts:81`, `test/entry.test.ts:82`
- App creation is lazy and once per process: the first request creates it, later requests reuse the same promise. `src/entry.ts:21`
- App creation that fails stays cached: every later request gets the same rejection. `src/entry.ts:21`
- Runtime env comes from the process environment: a secret set there reaches the droplet. `test/entry.test.ts:60`
- `/index.js` answers `cache-control: no-store`. `test/entry.test.ts:64`
- Bun engine is `>=1.2`. `package.json:35`
- Build script runs the tests before tsdown. `package.json:38`
- `BUN` names the bun binary for the tests; default `bun` on the `PATH`. `test/entry.test.ts:13`
- `BUN` may come from the root `.env.local`; a variable already set wins. `vitest.config.ts:5`, `../../shared/env.ts:6`
- Entry tests are skipped when `bun --version` does not succeed; the build test still runs. `test/entry.test.ts:14`, `test/entry.test.ts:31`
- Tests build the framework's fixture app and fail when `@dropletsjs/droplets` is not built. `test/build-fixture.ts:18`

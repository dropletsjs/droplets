# @dropletsjs/adapter-deno

The Deno adapter for [Droplets](../../droplets). With it, `vite build` writes
`dist/server.js`: a production server that `deno serve` runs, or that you
import for its `fetch` handler. The app is the [Node adapter](../node)'s,
running on Deno's `node:` modules.

```bash
deno add -D npm:@dropletsjs/adapter-deno
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { deno } from "@dropletsjs/adapter-deno";

export default defineConfig({
  plugins: [droplets({ adapter: deno(), renderers: [svelte()] })],
});
```

```bash
deno task build
deno serve -A --port 8000 dist/server.js
```

## Details

### Options

`deno()` takes no options.

### What `vite build` writes

The same layout as the Node adapter: `dist/server.js` (this package's
`entry.ts` with the Node adapter, Hono and the framework bundled in; it
imports only `node:*` modules), `dist/server/entry-server.js` (the SSR
bundle; your own dependencies stay external, so `node_modules` must be
present), `dist/server/_prerendered/` and `dist/client/`. Ship the whole
`dist/` folder.

### How the server starts

- `deno serve dist/server.js` serves the default export, `{ fetch }`.
  `deno serve` owns the address: `--port` (8000 unless you pass one), and
  `--parallel` for one worker per CPU core. `server.port` in
  `droplets.config.ts` and `PORT` do not apply.
- `-A` grants what the server needs: reading the build directory, the
  environment for your private variables, and the network.
- Importing `dist/server.js` does not listen; `default.fetch` is a
  `Request => Promise<Response>` handler for your own server.
- The app is created on the first request, once per process (once per
  worker with `--parallel`).

### Static files, `droplets.json`, environment

All from the Node adapter's `createNodeServerApp`: `/assets/*` from
`dist/client/assets` (hashed files immutable, `public/` under
`/assets/public/` revalidated), `droplets.json` read once, and
`DROPLETS_SECRET`, `DROPLETS_TRUSTED_ORIGINS`, `DROPLETS_ENV_MAX_AGE` and your
private variables from the process environment. It logs errors only.
See its [README](../node/README.md) and
[Deployment](https://dropletsjs.dev/guides/deployment/).

### Preview

`vite preview` runs the Node adapter's `createNodeServerApp` over the build,
in Vite's own process.

### Changing this package

`pnpm --filter @dropletsjs/adapter-deno build` runs the tests, then tsdown.
The tests build the framework's own fixture, so `@dropletsjs/droplets` must
be built first. `test/entry.test.ts` runs the built server with
`deno serve` and is skipped when no `deno` binary answers: set `DENO` (in the
environment or the root `.env.local`) for one off the `PATH`. `entry.ts` is a
tsdown entry: `deno()` finds `dist/entry.js` by path.

## Facts

- `deno()` takes no options and returns the adapter named `deno`. `src/index.ts:23`, `src/index.ts:25`
- `deno()` serverEntry is `dist/entry.js` of this package, found by path. `src/index.ts:26`
- `deno()` serverFile: `vite build` writes the server as `dist/server.js`. `src/index.ts:27`
- `deno()` separateSsrBundle is true: the SSR bundle is its own file, `dist/server/entry-server.js`. `src/index.ts:28`
- `deno()` noExternal bundles `@dropletsjs/adapter-node` and `@dropletsjs/adapter-deno` into `dist/server.js`. `src/index.ts:29`
- `dist/server.js` imports only `node:*` and holds no `@hono/node-server`. `test/index.test.ts:20`, `test/index.test.ts:21`
- `vite preview` serves `dist/client` and `dist/server/entry-server.js` through `createNodeServerApp` of `@dropletsjs/adapter-node`. `src/index.ts:30`
- `dist/server.js` resolves `client/` and `server/entry-server.js` relative to its own file, not the working directory. `src/entry.ts:10`
- `droplets.config.ts` is bundled into `dist/server.js` through `virtual:droplets-config`; it is not read at runtime. `src/entry.ts:3`
- `PORT` and `server.port` are not read: the config is resolved with no environment and `deno serve` owns the port. `src/entry.ts:17`
- Default export of `dist/server.js` is `{ fetch }` only. `src/entry.ts:26`
- `deno serve -A --port <port> dist/server.js` listens and logs `Listening on`. `test/entry.test.ts:37`, `test/entry.test.ts:51`
- Importing `dist/server.js` does not listen; `default.fetch` is a function. `test/entry.test.ts:80`, `test/entry.test.ts:81`
- App creation is lazy and once per process: the first request creates it, later requests reuse the same promise. `src/entry.ts:22`
- App creation that fails stays cached: every later request gets the same rejection. `src/entry.ts:22`
- Runtime env comes from the process environment: a secret set there reaches the droplet. `test/entry.test.ts:60`
- `/index.js` answers `cache-control: no-store`. `test/entry.test.ts:64`
- Deno engine is `>=2.0`. `package.json:35`
- Build script runs the tests before tsdown. `package.json:38`
- `DENO` names the deno binary for the tests; default `deno` on the `PATH`. `test/entry.test.ts:13`
- `DENO` may come from the root `.env.local`; a variable already set wins. `vitest.config.ts:5`, `../../shared/env.ts:6`
- Entry tests are skipped when `deno --version` does not succeed; the build test still runs. `test/entry.test.ts:14`, `test/entry.test.ts:31`
- Tests build the framework's fixture app and fail when `@dropletsjs/droplets` is not built. `test/build-fixture.ts:18`

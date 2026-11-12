`src/vite`: the Vite plugin (`@dropletsjs/droplets/vite`): discovery, virtual modules, `vite dev`, `vite build`, prerender and the authoring checks.

## Rules

- A server file (`*.server.*`, `+server.*`, a folder named `server` on its path) reached from a client entry fails `vite build` (the client environment's `buildEnd`) and is refused under `vite dev` as the import resolves, naming the import chain, through any chain.
  Checked by: `test/integration/server-only.test.ts`.
- `$droplets/server`, `@dropletsjs/droplets/server` and `$droplets/env/private` resolve only for project server files in a server environment; anywhere else the import fails, in build and in dev.
  Checked by: `test/vite/virtual.test.ts`, `test/vite/server-only.test.ts`, `test/integration/server-only.test.ts`.
- A droplet's component and error page reach only their own renderer's modules and neutral code: another configured renderer's files or packages fail every build environment's `buildEnd` and the dev import, naming the chain; script droplets are exempt.
  Checked by: `test/vite/renderer-graphs.test.ts`.
- Styles belong to the component: a stylesheet reached from `+droplet.ts` or `+droplet.server.ts` fails the build and the dev import.
  Checked by: `test/vite/renderer-graphs.test.ts`, `test/integration/load-css.test.ts`.
- The server-file, cross-framework and load-CSS checks run in both `vite build` (`buildEnd`) and `vite dev` (`resolveId`), so what builds also serves.
  Checked by: `test/integration/server-only.test.ts`, `test/integration/load-css.test.ts`.
- Under `vite dev` a droplet whose file fails to import fails alone: the server registry imports each droplet's modules on demand (`import()` behind a thunk, evaluated outside the request), so its fragment alone answers 500 while the other droplets, their `client.js` and `/index.js` keep answering, and the next request after the fix tries again; a build keeps static imports.
  Checked by: `test/vite/virtual.test.ts` ("imports each droplet's modules on demand under vite dev"), `../../../../tests/dev-mixed/test/dev-isolation.test.ts`.
- Flags reach the plugin only through `discoverDroplets`, which reads them from the droplet's component; the registries take `ssr`, `hydrate` and `prerender` from that entry and read none from `+droplet.ts`, `+droplet.server.ts` or `+error.*`.
  Checked by: `test/core/discover.test.ts`, `test/vite/virtual.test.ts`.
- Every URL a build writes for a droplet's own files is on the droplet location: browser bundles relative to the file that names them (`new URL(…, import.meta.url)` in JavaScript, a relative path in CSS), server bundles on `location` of the config in a build that sets it, else on the location token; never a root-relative `/assets/…`. A user's own `renderBuiltUrl` answers first.
  Checked by: `test/vite/assets.test.ts`, `test/integration/assets.test.ts` ("file URLs in a build with a fixed location").
- `dist/client/index.js` imports `env.js` (when runtime public variables are declared) and the entry statically, then writes the location record; nothing the browser reads at module top level depends on that record. `dist/client/index.css`, written only with a shared stylesheet, imports it from `assets/`; both are `no-store`.
  Checked by: `test/integration/index-js.test.ts`, `test/vite/build.test.ts`, `test/integration/empty-css.test.ts`, `../../../adapters/node/test/app.test.ts`.
- `public/` lands only in `dist/client/assets/public/` (every environment has `copyPublicDir: false`), and `vite dev` serves it at `/assets/public/*`.
  Checked by: `test/integration/assets.test.ts`.
- `virtual.ts` emits a client module's dev parts (`update`, the HMR fallback) only when `import.meta.env.DEV` holds for the run (`vite dev`, or a non-production build); `virtual:droplets-dev` is imported by the entry's dev module alone.
  Checked by: `test/vite/virtual.test.ts`, `tests/dev-mixed/test/production.test.ts`.
- `vite build` resolves `vite.config` again per environment, each with a fresh `droplets()` (its own `buildHash` and `tokenNonce`): names decided in the `config` hook carry no per-instance random state; output names use rolldown's `[hash]`, and build state lives in `sharedDuringBuild` plugins.
  Checked by: `tests/dev-mixed/test/production.test.ts` (a real `vite build --config`).
- Server bundles always bundle `SERVER_NO_EXTERNAL` (`hono`, `case-anything`, `@dropletsjs/droplets`, `@dropletsjs/renderer-*`), in `vite dev`'s ssr environment too.
  Checked by: `test/vite/build.test.ts`.
- `virtual:droplets-config` exports `tokens` (the `host-tokens` replacers) unless `vite build` has both `location` and `host`; then it exports `undefined`, the SSR bundle's `tokenNonce` is `undefined` and `$droplets/drop` holds no token. `vite dev` always computes both per request.
  Checked by: `test/vite/virtual.test.ts`, `test/integration/prerender-host.test.ts`, `tests/dev-mixed/test/production.test.ts`.
- The prerender pass evaluates the SSR bundle in a worker thread (`prerender-worker.ts`, through `../core/app-thread.ts`): the bundle finds a server's globals, not the build process's, and what it installs stays with it.
  Checked by: `test/integration/prerender-host.test.ts`, `packages/renderers/lit/test/conformance.test.ts`.
- `vite build` requires an adapter; `vite dev` runs without one.
  Checked by: `test/vite/build.test.ts`, `test/integration/vite.test.ts`.
- Code generated as strings calls the runtime entries in `dist/runtime/` with their exported signatures; a change to one of those signatures changes the template in the same commit.
  Checked by: `test/vite/virtual.test.ts`, `test/integration/vite.test.ts`.
- This folder is build tooling and runs on Node; no client entry reaches it.
  Checked by: `graphCheck()` in `../../tsdown.config.ts` (`vite/` on the server side).
- While editing, `pnpm dev:lib` (repo root) keeps `dist/` rebuilt; an example's Vite server restarts after a change to the `config` hook.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../../../docs/style/code.md`.

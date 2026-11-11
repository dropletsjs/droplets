`@dropletsjs/droplets`: the Vite plugin, the runtime (the Hono app and the custom element), the `djs` bin and the renderer and adapter contracts.

## Rules

- No dev or HMR code reaches a production bundle: dev code lives in `src/runtime/dev-*.ts` or a renderer's `clientDev`, and enters production code through the one `if (import.meta.env.DEV) installDevElement(...)` gate in `src/runtime/entry-client.ts`; the element class body holds no dev members.
  Checked by: `tests/dev-mixed/test/production.test.ts` (`DEV_MARKERS`: add a marker when you add dev code).
- Dev modules have no top-level side effects, and `import.meta.env.DEV` stays literal in `dist/`, so the consumer's Vite strips the dev path.
  Checked by: `tests/dev-mixed/test/production.test.ts`, `tests/packages/test/packed.test.ts`.
- `src/vite/virtual.ts` emits a client module's dev hooks (`update`, the HMR fallback) only under `vite dev` or a non-production build.
  Checked by: `tests/dev-mixed/test/production.test.ts` ("emits no update hook"), `test/vite/virtual.test.ts`.
- `*.server.*` and anything under `server/` never reach a client bundle, in build and in `vite dev`, through any import chain.
  Checked by: `src/vite/server-only.ts`, `test/integration/server-only.test.ts`; for this package's own output, `graphCheck()` in `tsdown.config.ts`.
- Every tsdown entry and server module is listed in `tsdown.config.ts`: `entry` when code finds it by path in `dist/`, and `graphCheck` `client` or `server` by where it runs; a renamed or added entry, dev module or server module updates those lists in the same change.
  Checked by: `graphCheck()` at build, `tests/packages/test/packed.test.ts`.
- A file the code finds by path in `dist/` (`src/core/paths.ts`, the generated modules, the renderers' `server`/`client` paths) is a tsdown `entry`, so its name stays fixed.
  Checked by: `tests/packages/test/packed.test.ts`.
- `src/runtime/`, `src/server/`, `src/core/config.ts` and `src/core/logger.ts` use web APIs only; Node lives in the adapters and the build tooling.
  Checked by: `test/portability.test.ts`: its `NEUTRAL` list names those paths; a new module that runs at runtime outside them goes into `NEUTRAL`.
- `vite build` resolves the config again per environment, and each environment gets a fresh `droplets()` instance with its own random build hash: names decided in the `config` hook carry no per-instance random state (use rolldown `[hash]` or shared hooks).
  Checked by: a real `vite build` of a project with a config file (`pnpm build:examples`, `pnpm test:e2e`).
- Flags (`ssr`, `hydrate`, `prerender`) live only in the droplet's component; anywhere else they are ignored, and on `+error.*` they warn in dev.
  Checked by: `test/core/discover.test.ts`.
- A flag mistake warns and is ignored; flags fail the build only in a Handlebars flags comment and in a script droplet (`ssr`, `hydrate = false`, `hydrate = "interactive"`).
  Checked by: `test/core/script.test.ts`, the Handlebars renderer's tests.
- The build fails for server code in a client bundle and for another framework's files or packages in a droplet, naming the import chain.
  Checked by: `test/integration/server-only.test.ts`, `test/vite/renderer-graphs.test.ts`, `tests/dev-mixed`.
- Every URL a droplet emits for its own files (`client.js`, `style.css`, its stylesheets, built and public files) is on the droplet location, so it works under any origin or prefix.
  Checked by: `test/integration/assets.test.ts`, `test/runtime/app.test.ts`.
- `handle` never runs for `/index.js` and `/assets/*`, and the health check answers before `handle`.
  Checked by: `test/runtime/app.test.ts` ("createDropletsApp: handle").
- `build` runs tsdown, then the tests (`tsdown && vitest run`), because the integration tests build against `dist/`; `build:dist` only compiles.
  Checked by: `package.json`.
- While editing, `pnpm dev:lib` (repo root) keeps `dist/` rebuilt; an example's Vite server restarts after a change to the plugin's `config` hook.
- The renderer contract is checked by `rendererConformance()` from `./testing`, which the renderer packages' conformance tests run and `test/conformance.test.ts` runs on `fakeRenderer()`.
  Checked by: `test/conformance.test.ts`, `packages/renderers/*/test/conformance.test.ts`.
- Runtime CSS lives in `.css` files imported with `?inline`.
  Checked by: `cssInline()` in `tsdown.config.ts`, `tests/packages/test/packed.test.ts`.
- New public API (config options, routes, the element contract, the renderer contract, `$droplets/*` modules) comes with the maintainer's go and a matching change in `apps/docs/`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../docs/style/code.md`.

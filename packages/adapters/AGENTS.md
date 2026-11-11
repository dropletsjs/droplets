`packages/adapters/*`: the `@dropletsjs/adapter-*` packages, one per runtime, each a `DropletsAdapter` (`packages/droplets/src/adapters.ts`) that `vite build` requires.

## Rules

- Node APIs live in the adapters and the build tooling; the framework's runtime and core stay Node-free.
  Checked by: `packages/droplets/test/portability.test.ts`.
- Each adapter's server entry (`src/entry.ts`, Cloudflare's `src/worker.ts`) is a tsdown entry, so the factory finds it in `dist/` by path.
  Checked by: `tests/packages/test/packed.test.ts`.
- What `vite build` writes for an adapter holds no dev or HMR code, Cloudflare's single `worker.js` included.
  Checked by: `tests/dev-mixed/test/production.test.ts`.
- `/assets/*` serves only the client build's `assets/` folder: hashed files `public, max-age=2592000, immutable`, `public/` under `/assets/public/` with `publicCacheControl` (`no-cache` by default), an `ETag` and 304; a path outside answers 404. On Cloudflare, `dist/client/_headers` carries the same `Cache-Control` for the static assets that answer first.
  Checked by: `node/test/static.test.ts`, `node/test/app.test.ts`, `cloudflare/test/worker.test.ts`, `cloudflare/test/index.test.ts`.
- A droplet name from the URL reaches a manifest only through `Object.hasOwn`.
  Checked by: `node/test/assets.test.ts`, `cloudflare/test/worker.test.ts`.
- Bun and Deno run on the Node adapter's `createNodeServerApp`; a serving change goes there.
  Checked by: `bun/test/entry.test.ts`, `deno/test/entry.test.ts`.
- `build` runs the tests before tsdown (`vitest run && tsdown`); `build:dist` only compiles. The tests build `packages/droplets/test/fixtures/app`, so `@dropletsjs/droplets` is built first.
  Checked by: each `package.json`, each `test/build-fixture.ts`.
- Every adapter's suite runs on `adapterTests` from `@dropletsjs/shared/vitest`, one test file per source file.
  Checked by: each `vitest.config.ts`.
- The Bun and Deno tests that run the built server are skipped when the binary is missing (`BUN`, `DENO`, or the `PATH`); their build tests always run.
  Checked by: `bun/test/entry.test.ts`, `deno/test/entry.test.ts`.
- Each package imports only what its `package.json` declares.
  Checked by: `graphCheck()` in each `tsdown.config.ts`, `tests/packages/test/packed.test.ts`.

If you need the facts, read them from each adapter's `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../docs/style/code.md`.

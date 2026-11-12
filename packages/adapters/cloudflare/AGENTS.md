`@dropletsjs/adapter-cloudflare`: the adapter that turns `vite build` into one self-contained `dist/worker.js` for Cloudflare Workers, the client build served through Workers Static Assets.

## Rules

- Node APIs run only at build time, in `src/index.ts`; `src/worker.ts` and everything `dist/worker.js` holds use web APIs only.
  Checked by: `test/index.test.ts` (no `node:*` import in `worker.js`).
- `dist/worker.js` is self-contained: every dependency is bundled, no `import` is left.
  Checked by: `test/index.test.ts`.
- `dist/worker.js` holds each framework's production build, never its development one, and no dev or HMR code.
  Checked by: `tests/dev-mixed/test/production.test.ts`.
- Prerendered renders are never in the bundle and never at a URL one could guess: a folder named anew every build, only in the inlined manifest; `droplets.json` and `.vite/` are never uploaded.
  Checked by: `test/worker.test.ts`, `test/index.test.ts`.
- Hashed files under `/assets/*` are `public, max-age=2592000, immutable`; `public/` under `/assets/public/*` gets `publicCacheControl` (`no-cache` by default), an `ETag` and 304.
  Checked by: `test/worker.test.ts`.
- Static assets answer the build's files before the Worker; `dist/client/_headers` gives `/index.js`, `/index.css`, `/assets/*`, `/assets/public/*` and each droplet's `client.js` and `style.css` their CORS and `Cache-Control`, each rule detaching `Cache-Control` first, and the project root's `_headers` is appended after them.
  Checked by: `test/index.test.ts`.
- The user's wrangler config is read, never written; a `run_worker_first` that sends one of the build's files through the Worker warns once and never fails the build, and unset or `false` is silent.
  Checked by: `test/index.test.ts`.
- A binding 404 leaves the Worker as the text `Not Found` with `no-store`, the Node adapter's answer; any other binding answer of 400 or more passes through with `no-store`.
  Checked by: `test/worker.test.ts`.
- The Worker's bindings are the runtime environment, set on every request before it is answered.
  Checked by: `test/worker.test.ts`.
- A droplet name from the URL reaches the inlined manifest only through `Object.hasOwn`.
  Checked by: `test/worker.test.ts`.
- `build` runs the tests before tsdown (`vitest run && tsdown`); `build:dist` only compiles.
  Checked by: `package.json`.
- The suite runs on `adapterTests` from `@dropletsjs/shared/vitest`.
  Checked by: `vitest.config.ts`.
- `src/worker.ts` is a tsdown entry, so `cloudflare()` finds `dist/worker.js` by path.
  Checked by: `tests/packages/test/packed.test.ts`.
- The package imports only what its `package.json` declares.
  Checked by: `graphCheck()` in `tsdown.config.ts`, `tests/packages/test/packed.test.ts`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../../docs/style/code.md`.

`@dropletsjs/adapter-node`: the adapter that turns `vite build` into `dist/server.js` for Node, and serves `vite preview`.

## Rules

- Node APIs live here, in the adapter; the framework's runtime and core stay Node-free.
  Checked by: `packages/droplets/test/portability.test.ts`.
- `/assets/*` serves only files inside `dist/client/assets`; any other path answers 404.
  Checked by: `test/static.test.ts`, `test/app.test.ts`.
- Hashed files under `/assets/*` are `public, max-age=2592000, immutable`; `public/` under `/assets/public/*` is revalidated (`no-cache`, an `ETag`, 304).
  Checked by: `test/static.test.ts`, `test/app.test.ts`.
- `build` runs the tests before tsdown (`vitest run && tsdown`); `build:dist` only compiles.
  Checked by: `package.json`.
- The suite runs on `adapterTests` from `@dropletsjs/shared/vitest`.
  Checked by: `vitest.config.ts`.
- `src/entry.ts` is a tsdown entry, so `node()` finds `dist/entry.js` by path.
  Checked by: `tests/packages/test/packed.test.ts`.
- `dist/server.js` imports only `node:*`: every package the server needs is in `noExternal` or the framework's own list.
  Checked by: `test/index.test.ts`.
- The package imports only what its `package.json` declares.
  Checked by: `graphCheck()` in `tsdown.config.ts`, `tests/packages/test/packed.test.ts`.
- A droplet name from the URL reaches the manifest only through `Object.hasOwn`.
  Checked by: `test/assets.test.ts`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../../docs/style/code.md`.

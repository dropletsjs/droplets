`@dropletsjs/adapter-deno`: the adapter that turns `vite build` into `dist/server.js` for `deno serve`, on the Node adapter's app.

## Rules

- The app is `createNodeServerApp` from `@dropletsjs/adapter-node`; serving rules (`/assets/*`, `droplets.json`, the environment) live there, not here.
  Checked by: `test/entry.test.ts`.
- `dist/server.js` imports only `node:*`: `@dropletsjs/adapter-node` and this package are in `noExternal`, the rest in the framework's own list.
  Checked by: `test/index.test.ts`.
- `deno serve` owns the address: the entry reads neither `PORT` nor `server.port`, and its default export is `{ fetch }` only.
- Importing `dist/server.js` never listens.
  Checked by: `test/entry.test.ts`.
- The entry tests run against a real `deno` and are skipped when none answers (`DENO` or the `PATH`); the build test always runs.
  Checked by: `test/entry.test.ts`.
- `build` runs the tests before tsdown (`vitest run && tsdown`); `build:dist` only compiles.
  Checked by: `package.json`.
- The suite runs on `adapterTests` from `@dropletsjs/shared/vitest`.
  Checked by: `vitest.config.ts`.
- `src/entry.ts` is a tsdown entry, so `deno()` finds `dist/entry.js` by path.
  Checked by: `tests/packages/test/packed.test.ts`.
- The package imports only what its `package.json` declares.
  Checked by: `graphCheck()` in `tsdown.config.ts`, `tests/packages/test/packed.test.ts`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../../docs/style/code.md`.

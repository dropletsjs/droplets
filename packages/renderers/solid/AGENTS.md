`@dropletsjs/renderer-solid`: the Solid renderer, `+droplet.tsx` rendered with `solid-js/web` on the server and hydrated or mounted in the browser.

Shared renderer rules: `../AGENTS.md`.

## Rules

- The renderer passes `rendererConformance()` of `@dropletsjs/droplets/testing` on its built bundles.
  Checked by: `test/conformance.test.ts`.
- `vite-plugin-solid` always runs with `ssr: true`: SSR output where the consumer is the server, hydratable DOM output in the browser.
  Checked by: `test/index.test.ts`.
- Hydration keys start with core's `renderId`, on the server and in the browser, so droplets on one page never share keys.
  Checked by: `test/server.test.ts`, `test/client.test.ts`.
- Every `hydrate` resets `_$HY.done` and `sharedConfig.done`, so a droplet hydrates in place after another one took an event.
  Checked by: `test/client.test.ts`.
- `client-setup.ts` keeps Solid's own event replay off (`events: null`); core replays the clicks held before hydration.
- The children marker is emptied while it is still in the document, before Solid removes it.
  Checked by: `test/client.test.ts`.
- `client-dev.ts` is the renderer's `clientDev`, imported only under `vite dev`; a production build holds none of it.
  Checked by: `tests/dev-mixed/test/production.test.ts`.
- The client entries (`client`, `client-dev`, `client-setup`, `form`) never reach `index`, `server` or a Node built-in.
  Checked by: `graphCheck()` in `tsdown.config.ts`, `tests/packages/test/packed.test.ts`.
- Every module core finds by path (`dist/server.js`, `client.js`, `client-dev.js`, `client-setup.js`) is a tsdown entry.
  Checked by: `test/index.test.ts`, `tests/packages/test/packed.test.ts`.
- The package imports only what its `package.json` declares.
  Checked by: `tests/packages/test/packed.test.ts`.
- `build` runs tsdown, then the tests, which use `dist/`; `build:dist` only compiles.
  Checked by: `package.json`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../../docs/style/code.md`.

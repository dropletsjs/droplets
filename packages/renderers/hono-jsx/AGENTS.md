`@dropletsjs/renderer-hono-jsx`: the Hono JSX renderer, `+droplet.tsx` written with `hono/jsx`, printed on the server and rendered with `hono/jsx/dom` in the browser.

Shared renderer rules: `../AGENTS.md`.

## Rules

- The renderer passes `rendererConformance()` of `@dropletsjs/droplets/testing` on its built bundles, with `adopts: false`.
  Checked by: `test/conformance.test.ts`.
- Components import from `hono/jsx` on both sides; in the client environment only, the plugin resolves `hono/jsx` and its runtimes to `hono/jsx/dom`.
  Checked by: `test/plugin.test.ts`.
- The plugin compiles only `.tsx`/`.jsx` outside `node_modules`, and only the modules core's `include` scope names when another renderer shares the extension.
  Checked by: `test/plugin.test.ts`.
- `packages` names `hono/jsx`, never `hono`: the server side of every droplet imports Hono.
  Checked by: `test/index.test.ts`.
- `hydrate` replaces the server markup with a fresh render in the same task; the element is never left empty for a frame.
  Checked by: `test/client.test.ts`.
- A load that rejects reaches `+error.tsx` through `handleError` and leaves no unhandled rejection.
  Checked by: `test/client.test.ts`.
- The children marker is emptied while it is still in the document.
  Checked by: `test/client.test.ts`.
- `unmount` leaves the target empty when it returns.
  Checked by: `test/client.test.ts`.
- `client-dev.ts` is the renderer's `clientDev`, imported only under `vite dev`; a production build holds none of it.
  Checked by: `tests/dev-mixed/test/production.test.ts`.
- The client entries (`client`, `client-dev`, `form`) never reach `index`, `server`, `plugin` or a Node built-in.
  Checked by: `graphCheck()` in `tsdown.config.ts`, `tests/packages/test/packed.test.ts`.
- Every module core finds by path (`dist/server.js`, `client.js`, `client-dev.js`) is a tsdown entry.
  Checked by: `test/index.test.ts`, `tests/packages/test/packed.test.ts`.
- The package imports only what its `package.json` declares.
  Checked by: `tests/packages/test/packed.test.ts`.
- `build` runs tsdown, then the tests, which use `dist/`; `build:dist` only compiles.
  Checked by: `package.json`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../../docs/style/code.md`.

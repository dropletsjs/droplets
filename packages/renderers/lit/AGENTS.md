`@dropletsjs/renderer-lit`: the Lit renderer, `+droplet.lit.ts` `LitElement` classes rendered with `@lit-labs/ssr` into a declarative shadow root and hydrated in place with `@lit-labs/ssr-client`.

Shared renderer rules: `../AGENTS.md`.

## Rules

- The renderer does not run `rendererConformance()` today; its browser behaviour (declarative shadow DOM, hydration in place, `innerHTML` insertion, forms, replayed clicks) is checked in Chromium.
  Checked by: `tests/examples/e2e/lit.spec.ts`.
- The tests run under Node with no DOM globals, as on a server: Lit's server build and DOM shim must find none.
  Checked by: `vitest.config.ts`, `test/integration/workers.test.ts`.
- The renderer defines every component class, under `<prefix>-<droplet id>` (`--error` for the error page); a name is never defined twice, a second class gets `--v<n>`.
  Checked by: `test/tags.test.ts`, `test/render.test.ts`.
- `data`, `form`, `actionUrl` and `error` reach the element as properties, never attributes, and `data` is always a value: the renderer awaits it.
  Checked by: `test/render.test.ts`.
- Server builds bundle Lit and its SSR packages and use Lit's `node/` server build, Workers included, so the server runs without a DOM or a Node API.
  Checked by: `test/plugin.test.ts`, `test/integration/workers.test.ts`.
- Server output defers hydration (`defer-hydration`); only the renderer's `hydrate` removes it, after setting the properties.
  Checked by: `test/render.test.ts`, `tests/examples/e2e/lit.spec.ts`.
- `client-setup.ts` loads `lit-element-hydrate-support` before any `lit-element` is evaluated.
- Form enhancement goes through the `enhance()` directive: a submit does not leave the shadow root, so `data-droplets-enhance` cannot reach it.
  Checked by: `tests/examples/e2e/lit.spec.ts`.
- `client-dev.ts` is the renderer's `clientDev`, imported only under `vite dev`; a production build holds none of it.
  Checked by: `tests/dev-mixed/test/production.test.ts`.
- The client entries (`client`, `client-dev`, `client-setup`, `element`, `form`) never reach `index`, `server`, `plugin`, `render` or a Node built-in.
  Checked by: `graphCheck()` in `tsdown.config.ts`, `tests/packages/test/packed.test.ts`.
- Every module core finds by path (`dist/server.js`, `client.js`, `client-dev.js`, `client-setup.js`) is a tsdown entry.
  Checked by: `test/index.test.ts`, `tests/packages/test/packed.test.ts`.
- The package imports only what its `package.json` declares.
  Checked by: `tests/packages/test/packed.test.ts`.
- `build` runs tsdown, then the tests, which use `dist/`; `build:dist` only compiles.
  Checked by: `package.json`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../../docs/style/code.md`.

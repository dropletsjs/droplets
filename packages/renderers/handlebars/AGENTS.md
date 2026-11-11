`@dropletsjs/renderer-handlebars`: the Handlebars renderer, `+droplet.hbs` precompiled at build, rendered on the server and kept as it is in the browser.

Shared renderer rules: `../AGENTS.md`.

## Rules

- The renderer passes `rendererConformance()` of `@dropletsjs/droplets/testing` on its built bundles, with `interactive: false` and `enhance: "attribute"`.
  Checked by: `test/conformance.test.ts`.
- Flags live only in the comment the template opens with; the reader is strict by design: a misplaced, misspelled, repeated or non-literal flag fails the build and `vite dev`.
  Checked by: `test/index.test.ts`.
- Flags exported from `+droplet.ts` or `+droplet.server.ts` are ignored, in a build and in `vite dev` alike.
  Checked by: `test/index.test.ts`.
- Only `handlebars/runtime` ships: the compiler (`handlebars`) runs in the plugin, in Node.
- Partials and helpers go into the renderer's own `Handlebars.create()` environment, never the global `Handlebars`.
  Checked by: `test/plugin.test.ts`.
- `children` and `action` are the renderer's helpers; a project's helper by either name is never registered.
  Checked by: `test/runtime.test.ts`.
- `<style>` blocks are static and at the top of a droplet template; a partial has none.
  Checked by: `test/styles.test.ts`, `test/plugin.test.ts`.
- `hydrate` keeps the server HTML; the children markers are emptied while they are still in the document.
  Checked by: `test/client.test.ts`.
- HMR code is emitted only by `vite dev` (`import.meta.hot.accept()` in compiled templates, `client-dev.ts`); a production build holds none of it.
  Checked by: `tests/dev-mixed/test/production.test.ts`, `test/plugin.test.ts`.
- The client entries (`client`, `client-dev`, `runtime`) never reach `index`, `server`, `plugin`, `styles` or a Node built-in.
  Checked by: `graphCheck()` in `tsdown.config.ts`, `tests/packages/test/packed.test.ts`.
- Every module found by path (`dist/server.js`, `client.js`, `client-dev.js`, and `runtime.js`, which compiled templates import) is a tsdown entry.
  Checked by: `test/index.test.ts`, `tests/packages/test/packed.test.ts`.
- The package imports only what its `package.json` declares.
  Checked by: `tests/packages/test/packed.test.ts`.
- `build` runs tsdown, then the tests, which use `dist/`; `build:dist` only compiles.
  Checked by: `package.json`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../../docs/style/code.md`.

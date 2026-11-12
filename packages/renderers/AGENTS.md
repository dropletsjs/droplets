`packages/renderers/*`: one `@dropletsjs/renderer-*` package per framework, each a `DropletRenderer` (`../droplets/src/renderer.ts`); these rules hold for every one of them.

## Rules

- A renderer is a function returning a `DropletRenderer`: `name`, `extensions`, `server`, `client`, and `packages`, `componentTypes`, `plugins`, `clientDev`, `clientSetup`, `readFlags`, `suffixes` as it needs them.
- The server module's `render` takes `{ data, form? }` or `{ error }` and returns a string or `{ html, head? }`; the client module exports `mount`, `hydrate` and `unmount`.
  Checked by: `test/conformance.test.ts` in each renderer.
- Every component renders the children marker `<div data-droplet-children style="display: contents">` and reports it with the host's `fill` and `empty`, while the marker is in the DOM.
  Checked by: `test/conformance.test.ts` in each renderer.
- `server`, `client`, `clientDev` and `clientSetup` are absolute paths into `dist/`, and each of those files is a tsdown `entry`, so its name stays fixed.
  Checked by: `tests/packages/test/packed.test.ts`.
- `packages` lists the framework's runtime packages and the renderer itself, so a droplet that reaches another framework fails the build and `vite dev`.
- `suffixes` claims the framework's own module suffixes (Svelte's `.svelte.ts`); a renderer that shares an extension with another sets `packages` so core can tell them apart.
- `plugins` that compile a shared extension take `scope.include` from core and compile only the modules it matches.
  Checked by: `tests/dev-mixed`, the renderers' mixed and refresh tests.
- Compile settings, HMR and refresh transforms live in the renderer's own plugin, never in Vite's shared options (`oxc`), which other compilers read.
  Checked by: `react/test/refresh.test.ts`, `tests/dev-mixed/test/dev.test.ts`.
- `update(instance, props)` lives in the `clientDev` module (`client-dev.ts`), which only `vite dev` and non-production builds import; every other dev line sits behind `import.meta.env.DEV`.
  Checked by: `tests/dev-mixed/test/production.test.ts` (`DEV_MODULE`, `DEV_MARKERS`: add a marker for new dev code).
- The Svelte renderer reads `experimental.async` from vite-plugin-svelte's options and never turns it on.
  Checked by: `svelte/test/conformance.test.ts`, `svelte/test/conformance-sync.test.ts`.
- Preact's Prefresh compiles in the renderer's own transform, never through `@prefresh/vite` or the shared `oxc` options.
  Checked by: `preact/test/plugin.test.ts`, `tests/dev-mixed/test/dev.test.ts`.
- `.svelte` files ship as source, copied as is, and the consumer's vite-plugin-svelte compiles them.
  Checked by: `tests/packages/test/packed.test.ts`.
- Each `tsdown.config.ts` runs `graphCheck({ client, server })`, and its lists name every client entry and every server module.
  Checked by: `graphCheck()` at build, `tests/packages/test/packed.test.ts`.
- A client entry imports only the framework and `@dropletsjs/droplets` client modules: no Node built-ins, no server module.
  Checked by: `tests/packages/test/packed.test.ts`.
- `build` is `tsdown && vitest run`: the tests import `dist/`, and a failing suite stops `pnpm build`.
- Every renderer runs `rendererConformance()` from `@dropletsjs/droplets/testing` in `test/conformance.test.ts`, under happy-dom (`rendererTests`, or the file's pragma where the package's other tests run under Node, as Lit's do); the kit's server renders in a worker thread, so a server build that shims the DOM (Lit SSR) passes it too.
  Checked by: `test/conformance.test.ts` in each renderer.
- `./form` is opt-in progressive enhancement over `@dropletsjs/droplets/enhance`; a form without it posts as any form does.
- The renderer contract is public API: a change needs the maintainer's approval and a matching change in `apps/docs/src/content/docs/renderers/index.mdx` ("Writing a renderer").
- A change to one renderer's behaviour usually belongs in the others and in `examples/frameworks/*`.

If you need the facts, read them from each renderer's `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../docs/style/code.md`.

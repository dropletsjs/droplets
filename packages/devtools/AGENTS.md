`@dropletsjs/devtools`: the Vite plugin that serves the devtools page on `/` and the floating dev tool under `vite dev`; development only.

## Rules

- The plugin applies to `vite dev` only: never to `vite build` or `vite preview`, so nothing of it reaches a production bundle.
  Checked by: `test/index.test.ts`, `tests/dev-mixed/test/production.test.ts` (no `devtools/` module in a build).
- The browser modules (`src/client/devtools-page.ts`, `src/tool/panel.ts`) reach no server code and no Node built-in; `src/index.ts` and `src/page.tsx` are server code.
  Checked by: `graphCheck()` in `tsdown.config.ts`, `tests/packages/test/packed.test.ts`.
- `src/shared.ts` uses no DOM and no Node: plain functions over plain data, for both sides.
- `src/client/devtools-page.ts` and `src/tool/panel.ts` are tsdown entries, so `src/index.ts` finds `dist/client/devtools-page.js` and `dist/tool/panel.js` by path.
  Checked by: `tests/packages/test/packed.test.ts`, `test/index.test.ts`.
- The package imports only what its `package.json` declares.
  Checked by: `graphCheck()` in `tsdown.config.ts`, `tests/packages/test/packed.test.ts`.
- Runtime CSS lives in `.css` files (`src/page.css`, `src/tool/panel.css`) imported with `?inline`.
  Checked by: `cssInline()` in `tsdown.config.ts`, `test/index.test.ts`.
- The page's own styles are added after `transformIndexHtml`, out of PostCSS and the droplets scoping.
  Checked by: `test/index.test.ts`.
- Data inlined in the page is JSON that cannot close its `<script>`.
  Checked by: `test/page.test.ts`.
- Types the core owns (`DropletSummary`, `DropletRegistryPayload`, `DropletsPluginApi`, `DevToolSource`, `DevNotification`) are imported by name from `@dropletsjs/droplets`, never copied.
- `build` runs tsdown, then the tests, which load `dist/`; `build:dist` only compiles.
  Checked by: `package.json`.
- `dropletsDevtools()`, `renderDevtoolsPage()` and their types are public API: a change needs the maintainer's go and a matching change in `apps/docs/`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../docs/style/code.md`.

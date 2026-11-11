`@dropletsjs/renderer-svelte`: the Svelte 5 renderer; the rules every renderer shares are in `../AGENTS.md`.

## Rules

- The renderer never turns on `experimental.async`: `droplets:svelte-options` reads it from vite-plugin-svelte's resolved options, and both modes work.
  Checked by: `test/conformance.test.ts` (async mode), `test/conformance-sync.test.ts` (without).
- `.svelte` files and `form.svelte.js` ship as source: tsdown copies them as is, and the consumer's vite-plugin-svelte compiles them.
  Checked by: `copy` and `neverBundle` in `tsdown.config.ts`, `test/index.test.ts`, `tests/packages/test/packed.test.ts`.
- A shipped `.svelte` file imports package code by its built name (`./children.js`), the file next to it in `dist/`.
  Checked by: `test/conformance.test.ts`.
- Flags come from the `<script module>` block alone, read with `readExportedFlags`.
  Checked by: `test/index.test.ts`, `test/integration/flags.test.ts`.
- Rune modules are Svelte's: `suffixes` lists `.svelte.ts` and `.svelte.js`.
- Error pages compile with `css: "injected"`, and the server returns their `<style>` as `head`.
  Checked by: `test/conformance.test.ts`.
- `update` lives in `client-dev.ts`, which only `vite dev` and non-production builds import.
  Checked by: `tests/dev-mixed/test/production.test.ts`.
- The graphCheck lists match the tsdown entries: client `client`, `client-dev`, `children`; server `index`, `server`.
  Checked by: `graphCheck()` in `tsdown.config.ts`, `tests/packages/test/packed.test.ts`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../../docs/style/code.md`.

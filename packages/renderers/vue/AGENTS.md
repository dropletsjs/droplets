`@dropletsjs/renderer-vue`: the Vue 3 renderer; the rules every renderer shares are in `../AGENTS.md`.

## Rules

- `+error.vue` compiles in plugin-vue's custom-element mode, combined with the user's `customElement`; the server returns its `styles` as `head`, the client injects them once and removes them when the last instance using them unmounts.
  Checked by: `test/server.test.ts`, `test/client.test.ts`, `test/conformance.test.ts`.
- Flags come from the plain `<script>` block alone, read with `readExportedFlags`.
  Checked by: `test/index.test.ts`.
- `<DropletChildren />` from `./children` is the only way to render host content; it fills in `onMounted` and empties in `onBeforeUnmount`, while the marker is still in the DOM.
  Checked by: `test/children.test.ts`.
- The marker sits in a fragment root, with `inheritAttrs: false`, so a scoped style never adds an attribute to it.
  Checked by: `test/server.test.ts`.
- The root renders the component under `<Suspense>`, so `await props.data` works in `<script setup>`.
  Checked by: `test/conformance.test.ts`.
- `update` lives in `client-dev.ts`, which only `vite dev` and non-production builds import; it returns `false` for an async `setup`, and core remounts.
  Checked by: `test/conformance.test.ts` (update in place), `tests/dev-mixed/test/production.test.ts`.
- The graphCheck lists match the tsdown entries: client `client`, `client-dev`, `children`, `form`; server `index`, `server`.
  Checked by: `graphCheck()` in `tsdown.config.ts`, `tests/packages/test/packed.test.ts`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../../docs/style/code.md`.

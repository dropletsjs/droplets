`@dropletsjs/renderer-preact`: the Preact 11 renderer; the rules every renderer shares are in `../AGENTS.md`.

## Rules

- JSX and Prefresh compile in `droplets:preact`'s own transform; the renderer never uses `@prefresh/vite`, `@preact/preset-vite` or Vite's shared `oxc` options.
  Checked by: `test/plugin.test.ts`, `tests/dev-mixed/test/dev.test.ts`.
- With another renderer on `.tsx`, `droplets:preact` compiles only the modules core's `scope.include` matches.
  Checked by: `test/plugin.test.ts`, `test/integration/mixed.test.ts`.
- Prefresh code reaches the browser only under `vite dev`, in the client environment.
  Checked by: `tests/dev-mixed/test/production.test.ts` (`__PREFRESH__`, `$RefreshReg$`, `$RefreshSig$`).
- A component always receives `data` as the value: `mount` and `update` await a promise first.
  Checked by: `test/client.test.ts`.
- A render after an `await` runs inside `context.rendering`, so `$droplets/form` still knows the droplet.
  Checked by: `test/client.test.ts`.
- `DropletChildren` fills in a layout effect and empties in its cleanup, keyed on the host alone.
  Checked by: `test/client.test.ts`.
- `update` lives in `client-dev.ts`, which only `vite dev` and non-production builds import.
  Checked by: `test/conformance.test.ts` (update in place), `tests/dev-mixed/test/production.test.ts`.
- The graphCheck lists match the tsdown entries: client `client`, `client-dev`, `form`; server `index`, `server`, `plugin`.
  Checked by: `graphCheck()` in `tsdown.config.ts`, `tests/packages/test/packed.test.ts`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../../docs/style/code.md`.

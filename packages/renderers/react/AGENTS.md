`@dropletsjs/renderer-react`: the React 19 renderer; the rules every renderer shares are in `../AGENTS.md`.

## Rules

- Fast Refresh compiles in `droplets:react-refresh` alone, for React's own modules in the browser; it stays off in Vite's shared `oxc` options.
  Checked by: `test/refresh.test.ts`.
- With another renderer on `.tsx`, both plugin-react and `droplets:react-refresh` take core's `scope.include` in place of their own match.
  Checked by: `test/refresh.test.ts`, `test/index.test.ts`.
- `client-setup` brings the Fast Refresh preamble with a static import, and its flag-ignoring code runs behind `import.meta.env.DEV`.
  Checked by: `tests/dev-mixed/test/production.test.ts` (`$RefreshReg$`, `__getReactRefreshIgnoredExports`, `__dropletsReactRefresh`).
- `mount`, `hydrate` and `update` run inside `flushSync`, so the host's container is back in the marker before the page paints.
  Checked by: `test/client.test.ts`.
- `DropletChildren` fills in a layout effect and empties in its cleanup, keyed on the host alone.
  Checked by: `test/client.test.ts`.
- React's error callbacks go to `console.error` with the droplet's name; only the droplet's own boundary stays quiet.
  Checked by: `test/client.test.ts`.
- `update` lives in `client-dev.ts`, which only `vite dev` and non-production builds import.
  Checked by: `test/conformance.test.ts` (update in place), `tests/dev-mixed/test/production.test.ts`.
- The graphCheck lists match the tsdown entries: client `client`, `client-dev`, `client-setup`, `form`; server `index`, `server`, `refresh`.
  Checked by: `graphCheck()` in `tsdown.config.ts`, `tests/packages/test/packed.test.ts`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../../docs/style/code.md`.

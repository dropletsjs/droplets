`core/`: the config, droplet and route discovery, the flags parser, `src/env.ts` and the logger, shared by the build, `vite dev` and the production server.

## Rules

- `config.ts` and `logger.ts` use web APIs only (no `node:` import, `Buffer`, `__dirname`, `process.argv`/`cwd`/`exit`, unguarded `process.env`); the other files here are build tooling on Node.
  Checked by: `../../test/portability.test.ts` (its `NEUTRAL` list names exactly these two core files).
- `logger.ts` is the log of `vite dev` and `vite build` (level from `DEV_DROPLETS_LOG`), with no top-level work, so it tree-shakes out of production bundles; the runtime reaches it only through `runtime/dev-log.ts` or behind `import.meta.env.DEV`.
  Checked by: `../../../../tests/dev-mixed/test/production.test.ts` (`DEV_MARKERS`).
- `resolveConfig` is pure: it reads no environment and no file; the caller passes `PORT`.
  Checked by: `../../test/core/config.test.ts`.
- Every file `paths.ts` names in `dist/` is a tsdown `entry`, so its name stays fixed.
  Checked by: `../../../../tests/packages/test/packed.test.ts` (each entry is at its fixed path in `dist/`).
- Flags (`ssr`, `hydrate`, `prerender`) are literal `export const` declarations read only from the droplet's component file; flags anywhere else are ignored (an `+error.*`'s with a dev warning).
  Checked by: `../../test/core/discover.test.ts`.
- `discoverDroplets` is the one list of droplets: the plugin, the build and the dev server all read it.
- `trustedOrigins` accepts `"*"` on the owner's explicit opt-in and never refuses it; the warning is the runtime's. `location` and `host` are one value each and never `"*"`.
  Checked by: `../../test/core/config.test.ts`.
- A config mistake throws when the config is resolved, with a `droplets:` message that names the fix.
  Checked by: `../../test/core/config.test.ts`.
- Config keys and types are named for what they are (`dropletsFolder`, `fragmentCacheControl`, `trustedOrigins`), never for one host or framework.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../../../docs/style/code.md`.

`tests/hosts`: each host in `examples/hosts` as a compose stack, a flow in Chromium against it, recorded; plus the Node hosts' type check and the static checks over `examples/` in `test/`.

## Rules

- `pnpm test:hosts` needs Docker; local settings come from the gitignored root `.env.local` (`.env.example` lists the names), variables already set win.
  Checked by: `run.mjs`.
- The runner is plain local Docker plus the Docker CLI's own `DOCKER_CONTEXT`: nothing remote-specific lives in this folder or any committed file.
- Every stack is the compose project `droplets-<host>` and is removed with `down -v` after its run, however the run ends.
  Checked by: `run.mjs`.
- `examples/hosts/hosts.json` is the one list of hosts: `run.mjs`, the docs and the READMEs' generated parts read it (through `@dropletsjs/shared/hosts`). Every folder in `examples/hosts` has a built entry there, with a port offset of its own and a flow that runs against it; a planned host is reserved there without a folder and shown nowhere.
  Checked by: `test/manifest.test.ts`.
- A count or a list of hosts in a README is a generated part (`<!-- hosts:<name> -->`), rewritten by `pnpm --filter @dropletsjs/tests-hosts readme`.
  Checked by: `test/manifest.test.ts`.
- The shop's `shop.css` is one file in every host that runs the shop; WordPress's is its own, for the theme's presets.
  Checked by: `test/shop-css.test.ts`.
- htmx's shop pages share their head, header and footer and swap `<main>` alone, every droplet asked for from inside it.
  Checked by: `test/htmx.test.ts`.
- Every host sends `x-droplet-location` from its environment or config, never from the request's `Host`; a new host is listed in the test with its files.
  Checked by: `test/location.test.ts`.
- Every host pastes a fragment's 504 as it pastes a 500 (both carry the droplet's error page) and waits 10 s or more for a fragment or `_data` answer; nginx answers its own failures from a backup, never with its own error page; a new host is listed in the test with its files.
  Checked by: `test/fragment-answers.test.ts`.
- Every example under `examples/` stands on its own: no `file:` or `link:` dependency, no import or `tsconfig` reaching above its folder.
  Checked by: `test/standalone.test.ts`.
- `test/` runs under vitest without Docker, in `pnpm test:integration`; the flows stay in `e2e/`.
  Checked by: `vitest.config.ts`, `package.json`.
- The Node hosts sit outside the pnpm workspace and type-check with their own install: `pnpm typecheck:hosts`, in CI too.
  Checked by: `typecheck.mjs`, `../../.github/workflows/ci.yml`.
- Recordings stay local (`recordings/`, gitignored); only `--docs` writes copies, to `apps/docs/public/hosts/`.
- A behaviour change comes with a test; a fix with a test that failed before it.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

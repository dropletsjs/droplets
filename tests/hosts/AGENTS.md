`tests/hosts`: each host in `examples/hosts` as a compose stack, a flow in Chromium against it, recorded; plus the Node hosts' type check.

## Rules

- `pnpm test:hosts` needs Docker; local settings come from the gitignored root `.env.local` (`.env.example` lists the names), variables already set win.
  Checked by: `run.mjs`.
- The runner is plain local Docker plus the Docker CLI's own `DOCKER_CONTEXT`: nothing remote-specific lives in this folder or any committed file.
- Every stack is the compose project `droplets-<host>` and is removed with `down -v` after its run, however the run ends.
  Checked by: `run.mjs`.
- Every host in `examples/hosts` is in `HOSTS`, with a flow that runs against it.
- The Node hosts sit outside the pnpm workspace and type-check with their own install: `pnpm typecheck:hosts`, in CI too.
  Checked by: `typecheck.mjs`, `../../.github/workflows/ci.yml`.
- Recordings stay local (`recordings/`, gitignored); only `--docs` writes copies, to `apps/docs/public/hosts/`.
- A behaviour change comes with a test; a fix with a test that failed before it.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

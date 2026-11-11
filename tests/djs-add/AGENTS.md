`tests/djs-add`: `djs add` end to end on a Svelte project, every framework and target, then a type check, a build and the built server.

## Rules

- Every framework `djs add` offers has its five cases (`full`, `loaded`, `static`, `browser`, `built`) in `FRAMEWORKS`.
  Checked by: `test/add.test.ts`.
- A droplet `djs add` writes type-checks, builds and serves.
  Checked by: `test/add.test.ts`.
- The tests edit a copy of `test/fixture` in `.tmp/project`, never the fixture.
- The tests run the packages' `dist/`: `pnpm build` first, then `pnpm test:integration`.
- A behaviour change comes with a test; a fix with a test that failed before it.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

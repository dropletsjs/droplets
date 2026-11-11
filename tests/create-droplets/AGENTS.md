`tests/create-droplets`: `npm create droplets` end to end, then `djs sync`, a type check, a build and the built server, per framework.

## Rules

- Every framework `create-droplets` offers has an `only-<framework>` case and is in the `everything` case.
  Checked by: `test/create.test.ts`.
- A new project syncs, type-checks, builds and serves every starter droplet without an install.
  Checked by: `test/create.test.ts`.
- The tests run the packages' `dist/`: `pnpm build` first, then `pnpm test:integration`.
- A behaviour change comes with a test; a fix with a test that failed before it.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

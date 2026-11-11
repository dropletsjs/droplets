`create-droplets`: the `npm create droplets` command, which asks for or reads the choices and writes a new Droplets project.

## Rules

- The starter droplets, the framework catalog, the target flags and the package managers come from `@dropletsjs/droplets`'s `src/add/` through `src/shared.ts`: a new project's droplets are exactly what `djs add` writes.
  Checked by: `tests/create-droplets/test/create.test.ts`.
- Versions are read from the workspace at build: each `@dropletsjs/*` package at `^<its version>`, every tool at its pnpm `catalog:` range; none is written by hand.
  Checked by: `versions.ts` (throws on a missing catalog entry), `test/files.test.ts`.
- `dist/index.js` is one file that needs only `@clack/prompts` and Node built-ins at runtime.
  Checked by: `vite.config.ts`, `tests/create-droplets/test/create.test.ts`.
- `bin/create-droplets.js` is a committed launcher that imports `../dist/index.js`, so pnpm links the bin before the build.
- `@dropletsjs/droplets` and `@dropletsjs/shared` are devDependencies only.
  Checked by: `package.json`.
- A run never overwrites a file: a non-empty folder is refused without a terminal, and every file is written with `wx` after a check for existing ones.
  Checked by: `tests/create-droplets/test/create.test.ts`.
- Without a terminal or with `--yes` it never prompts: a missing folder or `--frameworks` is an error that names the flag.
  Checked by: `tests/create-droplets/test/create.test.ts`.
- A generated project installs only versions published at least 7 days ago, with `@dropletsjs/*` exempt, for every package manager.
  Checked by: `test/files.test.ts`.
- A generated project types, builds and serves every starter droplet with every adapter.
  Checked by: `tests/create-droplets/test/create.test.ts`.
- The generated files (templates, `AGENTS.md`, `README.md`) are product output: change them only for what the project needs, with a test in `test/files.test.ts` or `test/agents.test.ts`.
- The flags and the generated project are user-facing: a change comes with the matching change in `apps/docs/` (`start/getting-started`) and a changeset.
- `build` runs the unit tests before `vite build`; `build:dist` only builds.
  Checked by: `package.json`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../docs/style/code.md`.

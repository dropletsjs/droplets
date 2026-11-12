# tests/create-droplets

`npm create droplets` end to end, as a user runs it without a terminal: each
framework alone, all eight with every adapter and Tailwind, and a pair with
the dev tool and Claude. Then what a user does next: `djs sync`, a type
check, a build, and the built server answering for every starter droplet.

```bash
pnpm build                                              # the packages' dist/ first
pnpm --filter @dropletsjs/tests-create-droplets test    # this suite
pnpm test:integration                                   # every tests/* suite
```

## Details

### What it needs

- Every package built, `create-droplets` included: the suite runs the
  `create-droplets`, `djs`, `tsc` and `vite` bins from its own
  `node_modules/.bin` (`pnpm build`, or `pnpm build:dist`).
- `git` on the `PATH` for the git cases.
- No fixed port: each project's built server gets one from `freePort()`.

### Where the projects go

Projects are written to `.tmp/` (gitignored), inside the workspace, with
`--no-install`: they resolve this suite's dependencies (the workspace
packages) instead of installing from npm. The first-commit case writes to a
`create-droplets-*` folder under the OS temp dir instead, outside any
repository, and removes it afterwards.

### What it checks

- Flag errors without a terminal: no `--frameworks`, no folder, a folder
  with files in it (left untouched).
- Git: a new project outside a repository gets the commit
  `Initial commit from create-droplets`; inside one, no `.git` is made.
- Per case (`only-<framework>` for each of the eight, `everything`, `pair`):
  the starter droplets are written, `CLAUDE.md` only with `--claude`,
  `dev: { injectTool: true }` with `--inject-tool`; `djs sync` writes
  `.droplets/tsconfig.json`; `tsc -p tsconfig.json` passes; `vite build`
  writes `dist/server.js`, which answers `/droplets/hello-<framework>?who=Ana`
  with `<h1>Hello Ana!</h1>`.
- `everything` also builds for Cloudflare with `DROPLETS_ADAPTER=cloudflare`
  and gets `dist/worker.js`.

## Facts

- Frameworks covered: svelte, vue, react, preact, solid, hono-jsx, handlebars, lit. `test/create.test.ts:26`
- Starter droplet name is `hello-<framework>`, `hello-hono` for hono-jsx. `test/create.test.ts:27`
- Cases: `only-<framework>` per framework, `everything` (all frameworks, adapters node,cloudflare,bun,deno, `--tailwind`), `pair` (react,svelte, `--no-tailwind --inject-tool --claude`). `test/create.test.ts:31`
- Bins run from this suite's `node_modules/.bin`. `test/create.test.ts:20`
- `npm_config_user_agent` is set to `pnpm/10` for every run. `test/create.test.ts:21`
- No `--frameworks` with `--yes` fails, names `--frameworks svelte,vue`, and writes no folder. `test/create.test.ts:51`
- No folder name fails with `name the folder`. `test/create.test.ts:56`
- A folder with files fails with `<name> is not empty` and keeps its files. `test/create.test.ts:60`
- Git first commit message is `Initial commit from create-droplets`, made outside any repository. `test/create.test.ts:80`
- Git: inside an existing repository it prints `already inside a git repository` and makes no `.git`. `test/create.test.ts:88`
- Git cases set `GIT_AUTHOR_*` and `GIT_COMMITTER_*` to a test identity. `test/create.test.ts:73`
- Projects are created with `--yes --no-install --no-git` in `.tmp/`. `test/create.test.ts:103`
- `CLAUDE.md` is written only for the `pair` case (`--claude`). `test/create.test.ts:105`
- `--inject-tool` writes `dev: { injectTool: true }` into `droplets.config.ts`. `test/create.test.ts:106`
- `djs sync` writes `.droplets/tsconfig.json`; then `tsc -p tsconfig.json` runs. `test/create.test.ts:109`
- Cloudflare build: `everything` with `DROPLETS_ADAPTER=cloudflare` writes `dist/worker.js`. `test/create.test.ts:116`
- Node build writes `dist/server.js`, started with `PORT` set and waited for (`waitForServer`) on the first starter droplet until its `x-droplets-build` is this build's (`fromBuild`). `test/create.test.ts:127`
- Ports come from `freePort()` of `@dropletsjs/shared/vitest`, one per case. `test/create.test.ts:124`
- Starter droplet answers 200 with `<h1>Hello Ana!</h1>` for `?who=Ana`, HTML comments stripped. `test/create.test.ts:137`
- Test and hook timeout 300 s. `vitest.config.ts:7`
- Test script is `vitest run`. `package.json:9`
- `.tmp/` is gitignored. `../../.gitignore:50`

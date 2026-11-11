# create-droplets

A new [Droplets](https://dropletsjs.dev) project: pick the frameworks, the
adapters and Tailwind, and get a typed project that builds, with a starter
droplet per framework and an `AGENTS.md` for coding agents.

```bash
npm create droplets@alpha my-widgets
pnpm create droplets@alpha my-widgets
yarn create droplets@alpha my-widgets
bun create droplets@alpha my-widgets
deno init --npm droplets my-widgets
```

```bash
npm create droplets@alpha my-widgets -- --frameworks svelte,react --adapters node,cloudflare --tailwind --yes
```

## Details

### What it asks

In a terminal it asks for what the flags leave out: the folder, the custom
element (the folder name, or `<folder>-droplets` when that has no hyphen),
the frameworks, the adapters, Tailwind, whether the dev tool goes on
external host pages under `vite dev`, whether you use Claude, and the
package manager (the one running it is preselected). Then it writes the
project, installs, runs `djs sync` and makes the first git commit
(`Initial commit from create-droplets`; skipped inside an existing
repository, a warning when git is missing or has no user).

Without a terminal, or with `--yes`, it asks nothing: the folder and
`--frameworks` are then required, and everything else takes its default.

| Flag | Does |
| --- | --- |
| `--element <name>` | The custom element every droplet renders in |
| `--frameworks <list>` | `svelte`, `vue`, `react`, `preact`, `solid`, `hono-jsx`, `handlebars`, `lit`, comma-separated |
| `--adapters <list>` | `node`, `cloudflare`, `bun`, `deno` (default: `node`) |
| `--tailwind`, `--no-tailwind` | Tailwind CSS in `src/app.css` |
| `--inject-tool` | `dev: { injectTool: true }` in `droplets.config.ts` |
| `--claude` | `CLAUDE.md` (`@AGENTS.md`) next to `AGENTS.md` |
| `--pm <pm>` | `npm`, `pnpm`, `yarn`, `bun` or `deno` |
| `--no-install` | Write the files only |
| `--no-git` | No `git init` |
| `--yes`, `-y` | Ask nothing; the folder and `--frameworks` are then required |

### What it writes

- `package.json`: `dev`, `build`, `preview`, `start`, `typecheck`, `sync`,
  `prepare` (`djs sync` after every install), and `build:<adapter>`,
  `start:<adapter>` for every adapter but the default one (Node when chosen,
  else the first). `vite build` builds for the default;
  `DROPLETS_ADAPTER=<adapter> vite build` for another. With Cloudflare,
  `deploy` (Cloudflare is the default) or `deploy:cloudflare`.
- `vite.config.ts` with the renderers, the adapters and `dropletsDevtools()`;
  `droplets.config.ts` with the element and `cors: true`.
- `tsconfig.json`, extending the generated `.droplets/tsconfig.json`.
- `src/app.css`, the stylesheet every droplet shares.
- One starter droplet per framework, `src/droplets/hello-<framework>/`, with a
  server load: what `djs add hello-<framework> --target full --with server`
  writes.
- `AGENTS.md`: the conventions, for coding agents, starting with the rule that
  a droplet imports only its own framework.
- `.gitignore`, `README.md`, `svelte.config.js` with Svelte (for editor
  tooling), and `wrangler.jsonc` with Cloudflare.
- The package manager's settings, installing only versions published at
  least 7 days ago (`@dropletsjs/*` exempt, so a project made on the day of a
  release installs): `.npmrc` (npm), `pnpm-workspace.yaml` (pnpm),
  `.yarnrc.yml` (Yarn), `bunfig.toml` (Bun) or `deno.json` (Deno).

The guide walks through a new project, from the first droplet to a plain
HTML page that embeds it:
[Getting started](https://dropletsjs.dev/start/getting-started/).

### Changing this package

- `src/choices.ts` reads the command line, `src/index.ts` asks the rest and
  runs the steps, `src/files.ts` and `src/agents.ts` write the files.
- The framework catalog, the droplet templates, the flags of a target and the
  package managers come from `@dropletsjs/droplets`'s `src/add/` sources,
  through `src/shared.ts`, so the starter droplets are what `djs add` writes.
  `vite build` bundles them into the one file `dist/index.js`.
- `versions.ts` bakes the versions in at build (and in the tests): each
  `@dropletsjs/*` package at `^<its version>`, the tools at the workspace's
  pnpm catalog ranges.
- `pnpm --filter create-droplets build` runs the unit tests, then
  `vite build`. `tests/create-droplets` runs the built bin end to end: every
  framework alone, all of them with every adapter, then sync, typecheck,
  build and the built server.

## Facts

- `create-droplets` bin is `bin/create-droplets.js`, a committed launcher that imports `../dist/index.js`, so pnpm can link it before the build. `package.json:24`, `bin/create-droplets.js:5`
- `create-droplets` publishes `bin`, `dist` and `README.md`; it has no `exports`. `package.json:26`
- `create-droplets` depends only on `@clack/prompts` at runtime. `package.json:41`
- `dist/index.js` is one ESM file for Node 22 with a `#!/usr/bin/env node` banner; `@clack/*` and Node built-ins stay external. `vite.config.ts:13`, `vite.config.ts:16`
- `dist/index.js` bundles the `@dropletsjs/droplets` sources it uses (`src/add/*`, `isValidElementName`). `vite.config.ts:20`, `src/shared.ts:7`
- Versions baked in: each `@dropletsjs/*` package at `^<version>` from its `package.json`. `versions.ts:62`
- Versions baked in: `vite`, `typescript`, `@types/node`, `tailwindcss`, `@tailwindcss/vite`, `wrangler`, `@types/react`, `@types/react-dom` from the pnpm catalog. `versions.ts:34`
- Versions: the build throws `the pnpm catalog in pnpm-workspace.yaml has no <tool>` when a tool is missing from the catalog. `versions.ts:67`
- `versionOf` throws `create-droplets: no version for <name>` for a package the build left out. `src/shared.ts:23`
- Flags: one positional folder; two or more throw `one folder, not <n>`. `src/choices.ts:182`
- Flags: an unknown option throws (Node's `parseArgs`, strict). `src/choices.ts:164`
- Flags: `--install` and `--git` default to true; `--no-install`, `--no-git` and `--no-tailwind` are negations. `src/choices.ts:167`, `src/choices.ts:176`
- Flags: `-y` is `--yes`, `-h` is `--help`. `src/choices.ts:178`
- `--help` prints the usage and exits 0. `src/index.ts:191`, `src/index.ts:237`
- `--frameworks` and `--adapters` are comma lists; an unknown name throws `--<flag> <name>: expected <list>`, an empty one `--<flag>: name at least one of <list>`. `src/choices.ts:153`, `src/choices.ts:156`
- `--frameworks` and `--adapters` drop repeats and end in catalog and `ADAPTERS` order, whatever order the flag gave. `src/choices.ts:157`, `src/choices.ts:203`
- `--frameworks` accepts `hono` for `hono-jsx` and refuses `script`. `../droplets/src/add/catalog.ts:131`
- `--pm` outside `npm`, `pnpm`, `yarn`, `bun`, `deno` throws `--pm <value>: expected …`. `src/choices.ts:193`
- `--element` that is not a valid custom element name throws `--element <name>: lowercase letters, digits and a hyphen, starting with a letter: my-widgets`. `src/choices.ts:107`, `src/choices.ts:197`
- Usage text says `--element` defaults to "the folder name"; the code appends `-droplets` when that name has no hyphen. `src/choices.ts:127`, `src/choices.ts:100`
- Interactive only with a TTY on stdin and stdout and no `--yes`. `src/index.ts:194`
- Non-interactive without a folder throws `name the folder: npm create droplets <folder> (or run it in a terminal to be asked)`. `src/index.ts:55`
- Non-interactive without `--frameworks` throws `pick the frameworks: --frameworks <list> (or run it in a terminal to be asked)`. `src/index.ts:87`
- Non-interactive defaults: adapters `node`, Tailwind, dev tool and Claude off, the detected package manager. `src/index.ts:113`, `src/index.ts:116`, `src/index.ts:126`
- Folder prompt default is `my-droplets`. `src/index.ts:62`
- Folder that exists and is not empty: non-interactive throws `<folder> is not empty; pick another folder`, interactive asks to write into it anyway. `src/index.ts:66`, `src/index.ts:67`
- Cancelling a prompt prints `Nothing written.` and exits 1. `src/index.ts:33`
- Package name: the folder's base name lowercased, runs outside `[a-z0-9._-]` as `-`, leading `.`, `_`, `-` and trailing `-` trimmed; empty becomes `droplets`. `src/choices.ts:87`
- Element suggestion: the package name without leading non-letters; itself when a valid element name, else `<name>-droplets`; nothing left gives `my-droplets`. `src/choices.ts:98`
- Package manager detection: `npm_config_user_agent`, else the nearest lockfile from the working directory, else npm. `src/index.ts:126`, `../droplets/src/add/install.ts:30`
- Files: a file that already exists stops the run before anything is written (`these files exist already: …`); each file is written with `wx`. `src/index.ts:157`, `src/index.ts:160`
- Install runs `<pm> install`, then `<pm run> sync` (Deno skips lifecycle scripts); a failure is a warning naming the command to run. `src/index.ts:208`, `src/index.ts:213`, `src/index.ts:216`
- Git: skipped with a warning when git is missing or the folder is inside a work tree; else `git init`, `git add -A`, `git commit -m "Initial commit from create-droplets"`. `src/index.ts:173`, `src/index.ts:174`, `src/index.ts:178`
- Git: a failing git step is a warning `git <step> failed: <first line>`, never a failure. `src/index.ts:181`
- Exit code is 0 after a run and 1 on an error, printed as `create-droplets: <message>`. `src/index.ts:237`, `src/index.ts:240`
- Commands per pm: npm `npm run`/`npx djs`, pnpm `pnpm run`/`pnpm exec djs`, yarn `yarn run`/`yarn djs`, bun `bun run`/`bunx djs`, deno `deno task`/`deno run -A npm:@dropletsjs/droplets/djs`. `src/choices.ts:53`
- Default adapter: `node` when chosen, else the first in `node`, `cloudflare`, `bun`, `deno` order. `src/choices.ts:77`
- Starter droplet folder: `hello-<framework>`, `hello-hono` for Hono JSX. `src/choices.ts:70`
- Starter droplets are `djs add`'s files for target `full`, hydrate `always`, with `+droplet.server.ts`. `src/files.ts:353`
- `package.json` scripts: `dev` `vite`, `build` `vite build`, `preview` `vite preview`, `start` for the default adapter. `src/files.ts:23`
- `package.json` start commands: `node dist/server.js`, `wrangler dev`, `bun dist/server.js`, `deno serve -A dist/server.js`. `src/files.ts:11`
- `package.json` other adapters get `build:<a>` (`DROPLETS_ADAPTER=<a> vite build`) and `start:<a>`. `src/files.ts:31`
- `package.json` `deploy` is `wrangler deploy` when Cloudflare is the default adapter, else `deploy:cloudflare`. `src/files.ts:29`, `src/files.ts:33`
- `package.json` `sync` and `prepare` are `djs sync`; `typecheck` is `djs sync && tsc -p tsconfig.json`. `src/files.ts:37`
- `package.json` is `private: true`, `type: module`, dependencies and devDependencies sorted by name. `src/files.ts:47`, `src/files.ts:85`
- `package.json` dependencies: `@dropletsjs/droplets` and each framework's own packages. `src/files.ts:67`
- `package.json` devDependencies: devtools, the adapters, the renderers, the frameworks' types, `vite`, `typescript`, `@types/node`, Tailwind when chosen, `wrangler` with Cloudflare. `src/files.ts:73`
- `vite.config.ts` calls one adapter directly; several pick by `process.env["DROPLETS_ADAPTER"]`, falling back to the default. `src/files.ts:109`
- `vite.config.ts` always adds `dropletsDevtools()` after `droplets()`. `src/files.ts:126`
- `vite.config.ts` sets `css: { tailwind: true }` with Tailwind. `src/files.ts:114`
- `droplets.config.ts` sets `element` and `cors: true`, plus `dev: { injectTool: true }` when chosen. `src/files.ts:144`, `src/files.ts:146`
- `tsconfig.json` extends `./.droplets/tsconfig.json`, with `types` `node`, `vite/client` and `@dropletsjs/droplets/ambient`. `src/files.ts:172`, `src/files.ts:176`
- `tsconfig.json` takes `jsx: "react-jsx"` and `jsxImportSource` from the first JSX framework, and then includes `src/**/*.tsx`. `src/files.ts:173`, `src/files.ts:175`
- `src/app.css` imports `tailwindcss` with Tailwind and makes `:root` `display: block`. `src/files.ts:196`
- `.gitignore` lists `node_modules/`, `dist/`, `.droplets/`, `.wrangler/`, `.env.local` and `.env.*.local`. `src/files.ts:205`
- `wrangler.jsonc` (Cloudflare): `main` `dist/worker.js`, `nodejs_compat`, assets `dist/client` bound as `ASSETS` with `run_worker_first: true`. `src/files.ts:226`
- `svelte.config.js` (Svelte) sets `compilerOptions: { runes: true }` for editor tooling. `src/files.ts:239`
- `CLAUDE.md` (with `--claude`) is `@AGENTS.md`. `src/files.ts:348`
- Release age settings: pnpm `minimumReleaseAge: 10080`, npm `min-release-age=7`, Yarn `npmMinimalAgeGate: 10080`, Bun `minimumReleaseAge = 604800`, Deno `P7D`. `src/files.ts:286`, `src/files.ts:298`, `src/files.ts:308`, `src/files.ts:320`, `src/files.ts:328`
- Release age exemption: `@dropletsjs/*` by pattern for pnpm, npm and Yarn; every `@dropletsjs/*` package by name for Bun and Deno. `src/files.ts:299`, `src/files.ts:321`
- `AGENTS.md` opens with the one-framework rule and is written for the chosen frameworks, adapters and package manager. `src/agents.ts:35`, `test/agents.test.ts:6`
- `AGENTS.md` adds the `@jsxImportSource` note only with two or more JSX frameworks. `src/agents.ts:68`
- Build script runs the tests, then `vite build`. `package.json:35`

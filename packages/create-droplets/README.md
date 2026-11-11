# create-droplets

A new [Droplets](https://dropletsjs.dev) project.

```bash
npm create droplets@alpha my-widgets
pnpm create droplets@alpha my-widgets
yarn create droplets@alpha my-widgets
bun create droplets@alpha my-widgets
deno init --npm droplets my-widgets
```

In a terminal it asks for what the flags leave out: the folder, the custom
element (the folder name, or `<folder>-droplets` when that has no hyphen),
the frameworks, the adapters, Tailwind, whether the dev tool goes on
external host pages under `vite dev`, whether you use Claude, and the
package manager (the one running it is preselected). Then it writes the
project, installs, runs `djs sync` and makes the first git commit
(`Initial commit from create-droplets`; skipped inside an existing
repository, a warning when git is missing or has no user).

```bash
npm create droplets@alpha my-widgets -- --frameworks svelte,react --adapters node,cloudflare --tailwind --yes
```

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

## What it writes

- `package.json`: `dev`, `build`, `preview`, `start`, `typecheck`, `sync`,
  `prepare` (`djs sync` after every install), `deploy` with Cloudflare, and
  `build:<adapter>`, `start:<adapter>` for every adapter but the default one
  (Node when chosen, else the first). `vite build` builds for the default;
  `DROPLETS_ADAPTER=<adapter> vite build` for another.
- `vite.config.ts` with the renderers, the adapters and `dropletsDevtools()`;
  `droplets.config.ts` with the element.
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

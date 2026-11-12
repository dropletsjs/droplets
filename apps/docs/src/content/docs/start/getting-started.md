---
title: Getting started
description: "npm create droplets: a new project, a first droplet, dev, build, and a plain HTML page that embeds it."
---

The quick path: `npm create droplets` writes a project with a first
droplet, and the steps below run it, edit it, build it and embed it in a
plain page. To add Droplets to a project you have, or to see what each file
does, follow [Manual setup](/start/manual-setup/) instead.

You need Node 22 or newer. The examples use npm and Svelte; every other
package manager and [renderer](/renderers/) works the same way.

## 1. Create a project

```bash
npm create droplets my-widgets
```

The same with the other package managers:

```bash
pnpm create droplets my-widgets
yarn create droplets my-widgets
bun create droplets my-widgets
deno init --npm droplets my-widgets
```

In a terminal it asks for what the command line leaves out: the folder, the
custom element (the folder's name, or `<folder>-droplets` when that has no
hyphen), the frameworks, the adapters (Node by default), Tailwind, the dev
tool on external host pages, and the package manager (the one running it
is preselected). Then it writes the project,
installs, runs `djs sync` and makes the first git commit.

Without a terminal, or with `--yes`, it asks nothing; the folder and
`--frameworks` are then required:

```bash
npm create droplets my-widgets -- --frameworks svelte --yes
```

| Flag | Does |
| --- | --- |
| `--element <name>` | The custom element every droplet renders in (default: the folder name, or `<folder>-droplets` when it has no hyphen) |
| `--frameworks <list>` | `svelte`, `vue`, `react`, `preact`, `solid`, `hono-jsx`, `handlebars`, `lit`, comma-separated |
| `--adapters <list>` | `node`, `cloudflare`, `bun`, `deno` (default: `node`) |
| `--tailwind`, `--no-tailwind` | Tailwind CSS in `src/app.css` |
| `--inject-tool` | The dev tool on every page that loads `index.js` under `vite dev` |
| `--claude` | `CLAUDE.md` (`@AGENTS.md`) next to `AGENTS.md` |
| `--pm <pm>` | `npm`, `pnpm`, `yarn`, `bun` or `deno` |
| `--no-install` | Write the files only |
| `--no-git` | No `git init` |
| `--yes`, `-y` | Ask nothing |

## 2. What you get

```
my-widgets/
  package.json          dev, build, preview, start, sync, typecheck; prepare runs djs sync
  vite.config.ts        droplets({ adapter: node(), renderers: [svelte()] }), dropletsDevtools()
  droplets.config.ts    element: "my-widgets", cors: true
  tsconfig.json         extends .droplets/tsconfig.json
  svelte.config.js      for editor tooling (Svelte only)
  src/app.css           the stylesheet every droplet shares
  src/droplets/hello-svelte/
    +droplet.svelte     the component
    +droplet.server.ts  its server load
  AGENTS.md             the conventions, for coding agents
  README.md
  .gitignore            node_modules/, dist/, .droplets/, …
  .npmrc                min-release-age=7 (the package manager's own file, below)
  .vscode/extensions.json  the Svelte editor extension (below)
```

There is one starter droplet per framework you picked, `hello-<framework>`
(`hello-hono` for Hono JSX). `.droplets/` holds each droplet's generated
[`./$types`](/guides/writing-droplets/#types-types) and is not in git.
`vite dev` and `vite build` keep it up to date; `djs sync` (`npm run sync`)
writes it without them, `prepare` runs it after every install, and
`npm run typecheck` runs it before `tsc`.

With more than one adapter, `vite build` builds for Node (or the first one
chosen), and `DROPLETS_ADAPTER=<adapter> vite build` for another; the
`build:<adapter>` and `start:<adapter>` scripts do that.

`.vscode/extensions.json` recommends the editor extensions the frameworks
you picked need: `svelte.svelte-vscode` for Svelte, `Vue.volar` for Vue,
`runem.lit-plugin` for Lit. React, Preact, Solid, Hono JSX and Handlebars
need none; a project with only those gets no file.

The package manager's settings install only versions published at least 7
days ago, with Droplets' own packages exempt so a project made on the day of
a release installs: `.npmrc` for npm (`min-release-age`, npm 11.10 and
later), `pnpm-workspace.yaml` for pnpm (`minimumReleaseAge`),
`.yarnrc.yml` for Yarn (`npmMinimalAgeGate`, Yarn 4.10 and later),
`bunfig.toml` for Bun (`minimumReleaseAge`) and `deno.json` for Deno
(`minimumDependencyAge`).

## 3. Run it

```bash
cd my-widgets
npm run dev
```

| URL | What you see |
| --- | --- |
| `http://localhost:5173/` | The devtools page: pick `hello-svelte`, edit its props, watch it render |
| `http://localhost:5173/droplets/hello-svelte?who=Ana` | The fragment another page embeds |
| `http://localhost:5173/droplets/hello-svelte/_data?who=Ana` | The server load's result, as JSON: `{"data":{"greeting":"Hello Ana!"}}` |

## 4. Edit the starter droplet

The starter droplet is a server load and a component:

```ts
// src/droplets/hello-svelte/+droplet.server.ts
import type { LoadEvent } from "./$types";

/** Runs on the server for every request: read secrets, databases and `locals` here. */
export const load = ({ props }: LoadEvent) => {
  const who = typeof props["who"] === "string" ? props["who"] : "world";
  return { greeting: `Hello ${who}!` };
};
```

Give the component a button:

```svelte ins={11,18}
<!-- src/droplets/hello-svelte/+droplet.svelte -->
<script module lang="ts">
  export const ssr = true;
  export const hydrate = true;
</script>

<script lang="ts">
  import type { DropletProps } from "./$types";

  let { data, children }: DropletProps = $props();
  let clicks = $state(0);
</script>

<section class="hello-svelte">
  {#await data then { greeting }}
    <h1>{greeting}</h1>
  {/await}
  <button onclick={() => (clicks += 1)}>clicked {clicks} times</button>
  {@render children?.()}
</section>
```

Save it: the droplet updates in place, without a page reload. `data` is
the load's result, typed through `./$types`, so neither file spells it out.
`ssr` and `hydrate` are the droplet's [flags](/guides/writing-droplets/#flags);
[Hot updates](/guides/development/#hot-updates) says what survives an edit.

Props come from the caller, so this load checks `who` itself. A
[props schema](/guides/writing-droplets/#a-props-schema) in `+droplet.ts`
does it for every prop, before any load runs.

## 5. Add a droplet: `djs add`

```bash
npx djs add counter
```

In a terminal it asks for the framework, the target (`full`, `ssr`,
`client`, `ssg`), when a `full` droplet hydrates and the optional files.
For a script or an agent, pass everything:

```bash
npx djs add counter --framework svelte --target full --hydrate visible --with server,css --yes
```

It writes `src/droplets/counter/` (`+droplet.svelte` with
`hydrate = "visible"` and a `<style>` block, and `+droplet.server.ts`), then
its `./$types`. A framework the Vite config does not list yet is installed
and added to it, after asking ([Add a renderer](/renderers/#add-a-renderer)).
Every option is in the [API reference](/reference/api/#djs-add).

## 6. Build and run

```bash
npm run build     # dist/client, dist/server, dist/server.js
npm run preview   # the build, on http://localhost:4173
npm start         # node dist/server.js, on http://localhost:8000
```

`dist/server.js` bundles the framework's own dependencies, so a production
machine needs Node, `dist/` and whatever your droplets import, nothing
else. `PORT` moves it. See [Deployment](/guides/deployment/) for Workers,
Bun, Deno and Docker.

## 7. Embed it in a plain HTML page

Any page, served by anything, needs the entry script once and the droplet
element. The simplest page writes the element itself, and the droplet
mounts in the browser:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>A plain page</title>
    <script type="module" src="http://localhost:8000/index.js"></script>
  </head>
  <body>
    <my-widgets data-droplet="hello-svelte" data-droplet-props='{"who":"Ana"}'></my-widgets>
  </body>
</html>
```

Serve it from another origin (`python3 -m http.server 8080` in its folder)
and open `http://localhost:8080/`: the droplet loads its bundle and data
from where `index.js` came from, and the button counts. `cors: true` in
`droplets.config.ts` is what lets a page on another origin load them.

A page with a server of its own pastes the server-rendered fragment
instead, so the markup is there before any JavaScript runs:

```html
<script type="module" src="http://localhost:8000/index.js"></script>

<!-- the body of GET http://localhost:8000/droplets/hello-svelte?who=Ana, pasted in -->
<my-widgets data-droplet="hello-svelte" data-droplet-build="…" data-droplet-render="…">…</my-widgets>
```

[Known hosts](/integrate/hosts/overview/) does the same in eleven host
examples, [Any other stack](/integrate/any-stack/) has the exact headers, and
[Security model](/guides/security/) says what a droplets server learns
about the pages that embed it.

[Manual setup](/start/manual-setup/), the next page, sets the same project
up by hand, for an existing project or to see what each file does. [Writing droplets](/guides/writing-droplets/) covers the flags,
the load chain and props; [Actions](/guides/actions/) and
[Prerendering](/guides/prerendering/) follow it.

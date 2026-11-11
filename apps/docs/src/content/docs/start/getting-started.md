---
title: Getting started
description: "npm create droplets: a new project, a first droplet, dev, build, and a plain HTML page that embeds it."
---

You need Node 22 or newer. The examples use npm and Svelte; every other
package manager and [renderer](/renderers/) works the same way.

## 1. Create a project

```bash
npm create droplets@alpha my-widgets
```

The same with the other package managers:

```bash
pnpm create droplets@alpha my-widgets
yarn create droplets@alpha my-widgets
bun create droplets@alpha my-widgets
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
npm create droplets@alpha my-widgets -- --frameworks svelte --yes
```

| Flag | Does |
| --- | --- |
| `--element <name>` | The custom element every droplet renders in |
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
```

There is one starter droplet per framework you picked, `hello-<framework>`
(`hello-hono` for Hono JSX). `.droplets/` holds each droplet's generated
[`./$types`](/guides/writing-droplets/#types-types); it is not in git, and
`djs sync` writes it again.

With more than one adapter, `vite build` builds for Node (or the first one
chosen), and `DROPLETS_ADAPTER=<adapter> vite build` for another; the
`build:<adapter>` and `start:<adapter>` scripts do that.

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

## 4. The first droplet

The starter droplet is a component and a server load:

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

```svelte
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

Save it: the droplet updates in place through Svelte's own HMR, and the
page does not reload. Svelte 5 creates the component again, so `clicks`
starts over. An edit to `+droplet.server.ts` brings the new `data` to the
running component and keeps `clicks`. See
[Hot updates](/guides/development/#hot-updates). `data` is what the load
returns: the load's result, typed through `./$types`, so neither file
spells it out. The template uses `{#await}` so it also works with Svelte's
[`experimental.async`](/renderers/svelte/#specifics), which hands a droplet
mounted in the browser a promise. The flags (`ssr`,
`hydrate`, `prerender`) are explained in
[Writing droplets](/guides/writing-droplets/#flags).

Props come from the caller, so the load checks them itself. For more than
one prop, a [props schema](/guides/writing-droplets/#a-props-schema) in
`+droplet.ts` checks and coerces them before any load runs, and refuses bad
ones with a `400`.

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
and added to it, after a warning. Every option is in the
[API reference](/reference/api/#djs-add).

## 6. Types: `djs sync`

```bash
npm run typecheck   # djs sync, then tsc
```

`vite dev` and `vite build` keep `.droplets/` up to date. `djs sync`
(`npm run sync`) writes it without either, for a type check on a fresh
checkout; `prepare` runs it after every install.

## 7. Build and run

```bash
npm run build     # dist/client, dist/server, dist/server.js
npm run preview   # the build, on http://localhost:4173
npm start         # node dist/server.js, on http://localhost:8000
```

`dist/server.js` bundles the framework's own dependencies, so a production
machine needs Node, `dist/` and whatever your droplets import, nothing
else. `PORT` moves it. See [Deployment](/guides/deployment/) for Workers,
Bun, Deno and Docker.

## 8. Embed it in a plain HTML page

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
    <my-widgets data-droplet="hello-svelte" data-params='{"who":"Ana"}'></my-widgets>
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
<my-widgets data-droplet="hello-svelte" data-build="…" data-render-id="…">…</my-widgets>
```

[Known hosts](/integrate/hosts/overview/) does the same in eleven host
examples, [Any other stack](/integrate/any-stack/) has the exact headers, and
[Security model](/guides/security/) says what a droplets server learns
about the pages that embed it.

[Manual setup](/start/manual-setup/), the next page, sets the same project
up by hand. [Writing droplets](/guides/writing-droplets/) covers the flags,
the load chain and props; [Actions](/guides/actions/) and
[Prerendering](/guides/prerendering/) follow it.

---
title: Manual setup
description: "What npm create droplets writes, set up by hand in a new or existing project: packages, Vite and droplets configs, typings, scripts and a first droplet."
---

[`npm create droplets`](/start/getting-started/) writes all of this for you.
Set it up by hand to add Droplets to a project you already have, or to see
what each file does. You need Node 22 or newer; the examples use npm and
Svelte, and any other [renderer](/renderers/) works the same way. Once the
six steps below are done, the project is the one Getting started creates:
continue there at [step 3](/start/getting-started/#3-run-it).

## 1. Install

```bash
npm install @dropletsjs/droplets @dropletsjs/renderer-svelte svelte
npm install -D vite typescript @types/node @dropletsjs/adapter-node @dropletsjs/devtools
```

Vite 8 and your UI framework are peer dependencies: your project owns their
versions. The adapter decides what `vite build` emits; `@dropletsjs/adapter-node`
gives you a `dist/server.js` to run with Node. See
[Adapters](/guides/deployment/#adapters) for Cloudflare Workers, Bun and
Deno.

## 2. Configure Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";
import { dropletsDevtools } from "@dropletsjs/devtools";
import { node } from "@dropletsjs/adapter-node";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [svelte()] }), dropletsDevtools()],
});
```

The plugin registers each renderer's own Vite plugin for you (and Tailwind 4
with `css: { tailwind: true }`; see [`css`](/guides/configuration/#css)),
and sets up three build environments: browser, SSR and server. The devtools
serve a development page at `/`, under `vite dev` only.

## 3. Configure droplets

```ts
// droplets.config.ts
import { config } from "@dropletsjs/droplets";

export default config({
  element: "my-widgets",
  cors: true,
});
```

`element` names the custom element every droplet renders in; give each
droplets server its own. `cors` lets pages on other origins load your
droplets. Every option is optional; see [Configuration](/guides/configuration/).

## 4. Typings

```json
// tsconfig.json
{
  "extends": "./.droplets/tsconfig.json",
  "compilerOptions": {
    "types": ["node", "vite/client", "@dropletsjs/droplets/ambient"]
  }
}
```

The ambient types declare `$droplets/env`, `$droplets/server` and the other
`$droplets/*` modules. `.droplets/` holds each droplet's
[`./$types`](/guides/writing-droplets/#types-types), written by `vite dev`,
`vite build` and `djs sync`; keep it out of git:

```bash
echo ".droplets/" >> .gitignore
```

With Svelte, a `svelte.config.js` with `compilerOptions: { runes: true }`
gives the editor tooling runes mode; the renderer turns it on for the build
either way.

## 5. Scripts

```json
// package.json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "start": "node dist/server.js",
    "sync": "djs sync",
    "typecheck": "djs sync && tsc -p tsconfig.json",
    "prepare": "djs sync"
  }
}
```

`prepare` runs after every install, so a fresh checkout has its types before
the editor or `tsc` asks for them. `start` is the Node adapter's; the
[other adapters](/guides/deployment/#adapters) run `wrangler dev`,
`bun dist/server.js` or `deno serve -A dist/server.js`.

## 6. A first droplet

One folder per droplet under `src/droplets`, with a `+droplet.<ext>` inside.
`djs add` writes the same starter droplet `npm create droplets` does:

```bash
npx djs add hello-svelte --framework svelte --target full --hydrate always --with server --yes
```

Or by hand, a server load and a component:

```ts
// src/droplets/hello-svelte/+droplet.server.ts
import type { LoadEvent } from "./$types";

/** Runs on the server for every request: read secrets, databases and `locals` here. */
export const load = ({ props }: LoadEvent) => {
  const who = typeof props["who"] === "string" ? props["who"] : "world";
  return { greeting: `Hello ${who}!` };
};
```

```svelte
<!-- src/droplets/hello-svelte/+droplet.svelte -->
<script module lang="ts">
  export const ssr = true;
  export const hydrate = true;
</script>

<script lang="ts">
  import type { DropletProps } from "./$types";

  let { data, children }: DropletProps = $props();
</script>

<section class="hello-svelte">
  {#await data then { greeting }}
    <h1>{greeting}</h1>
  {/await}
  {@render children?.()}
</section>
```

That is the project Getting started creates. Continue at
[step 3, Run it](/start/getting-started/#3-run-it): `npm run dev`, the
devtools page on `http://localhost:5173/`, then the edit, the build and a
plain HTML page that embeds it.

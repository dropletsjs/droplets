---
title: Manual setup
description: "The same project as npm create droplets, set up by hand: packages, configs, typings and scripts."
---

[`npm create droplets`](/start/getting-started/) writes all of this for you.
Here it is by hand, for an existing project or to see what each piece does.
You need Node 22 or newer and a package manager; the examples use pnpm and
Svelte. Any other [renderer](/renderers/) works the same way.

## 1. Install

```bash
pnpm add @dropletsjs/droplets@alpha @dropletsjs/renderer-svelte@alpha svelte
pnpm add -D vite typescript @dropletsjs/adapter-node@alpha @dropletsjs/devtools@alpha
```

Vite 8 and your UI framework are peer dependencies: your project owns their
versions. The adapter decides what `vite build` emits; `@dropletsjs/adapter-node` gives you
a `dist/server.js` to run with Node. See [Adapters](/guides/deployment/#adapters)
for Cloudflare Workers, Bun and Deno.

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
serve a development page at `/`, in `vite dev` only.

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
    "types": ["vite/client", "@dropletsjs/droplets/ambient"]
  }
}
```

The ambient types declare `$droplets/env`, `$droplets/server` and the other
`$droplets/*` modules. `.droplets/` holds each droplet's
[`./$types`](/guides/writing-droplets/#types-types), written by `vite` and by
`djs sync`; keep it out of git:

```bash
echo ".droplets/" >> .gitignore
```

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
    "prepare": "djs sync"
  }
}
```

`prepare` runs after every install, so a fresh checkout has its types before
the editor or `tsc` asks for them.

## 6. A first droplet

One folder per droplet under `src/droplets`, with a `+droplet.<ext>` inside.
`pnpm exec djs add hello` writes one for you, asking what it should be; here it
is by hand:

```svelte
<!-- src/droplets/hello/+droplet.svelte -->
<script lang="ts">
  import type { DropletProps } from "./$types";

  let { data }: DropletProps = $props();
  let clicks = $state(0);
</script>

<h1>Hello {data.who}!</h1>
<button onclick={() => (clicks += 1)}>clicked {clicks} times</button>
```

And a server load next to it, which turns the caller's props into the
component's `data`:

```ts
// src/droplets/hello/+droplet.server.ts
import type { LoadEvent } from "./$types";

export const load = ({ props }: LoadEvent) => ({
  who: typeof props.who === "string" ? props.who : "world",
});
```

`./$types` comes from the droplet's own files: `data` in the component is what
this load returns, so neither side spells it out.

Props come from the caller, so the load checks them itself here. For more than
one prop, a [props schema](/guides/writing-droplets/#a-props-schema) in
`+droplet.ts` (zod, valibot…) checks and coerces them before any load runs,
and refuses bad ones with a `400`.

## 7. Run it

```bash
pnpm dev
```

| URL | What you see |
| --- | --- |
| `http://localhost:5173/` | The devtools page: pick `hello`, edit its props, watch it render |
| `http://localhost:5173/droplets/hello?who=Ana` | The fragment another page embeds |
| `http://localhost:5173/droplets/hello/_data?who=Ana` | The server load's result, as JSON |

Edit the component: it updates in place. Add a folder under `src/droplets`: it
is routable at once.

## 8. Build and run for real

```bash
pnpm build        # dist/client, dist/server, dist/server.js
pnpm start        # http://localhost:8000
```

`dist/server.js` bundles the framework's own dependencies, so a production
machine needs Node, `dist/` and whatever your droplets import; nothing else.

## 9. Embed it

Any page, served by anything, needs two things: the entry script once, and
the fragment (or an element it writes itself).

```html
<script type="module" src="http://localhost:8000/index.js"></script>

<!-- the body of GET http://localhost:8000/droplets/hello?who=Ana, pasted in -->
<my-widgets data-droplet="hello">…</my-widgets>
```

[Getting started](/start/getting-started/#8-embed-it-in-a-plain-html-page)
has a complete page, and [Known hosts](/integrate/hosts/overview/) shows the same
thing from nine stacks.

Next: [Writing droplets](/guides/writing-droplets/) covers the flags, the load
chain, props, actions and prerendering.

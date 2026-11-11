# @dropletsjs/renderer-svelte

The Svelte 5 renderer for [Droplets](https://dropletsjs.dev):
`+droplet.svelte` and `+error.svelte`, rendered on the server and hydrated or
mounted in the browser.

The docs page, with a live droplet: [Svelte](https://dropletsjs.dev/renderers/svelte/).

```bash
pnpm add @dropletsjs/renderer-svelte@alpha svelte
```

```ts
// vite.config.ts
import { droplets } from "@dropletsjs/droplets/vite";
import { svelte } from "@dropletsjs/renderer-svelte";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [svelte()] })],
});
```

```svelte
<!-- src/droplets/hello/+droplet.svelte -->
<script module lang="ts">
  export const hydrate = true; // flags: ssr, hydrate, prerender
</script>

<script lang="ts">
  import type { DropletProps } from "./$types"; // data: what +droplet.server.ts's load returns

  let { data, children }: DropletProps = $props();
  let clicks = $state(0);
</script>

<h1>{data.greeting}</h1>
<button onclick={() => (clicks += 1)}>{clicks}</button>
{@render children?.()}
```

```svelte
<!-- src/droplets/hello/+error.svelte -->
<script lang="ts">
  import type { DropletErrorProps } from "@dropletsjs/renderer-svelte";
  let { error, children }: DropletErrorProps<{ message: string }> = $props();
</script>

<p>{error.message}</p>
{@render children?.()}
```

- **Flags** are literal exports in `<script module>`.
- **Children:** `{@render children?.()}` renders the host's content. It may
  sit under an `{#if}`; the content is moved out and back, never destroyed.
- **Data as a promise:** the renderer never turns on `experimental.async`; it
  reads whether you did (in `svelte.config.js` or `vitePlugin`). With it on, a
  droplet mounted from scratch gets `data` as a promise: `{(await data).greeting}`,
  and a rejection reaches the renderer's boundary or your `<svelte:boundary>`.
  Without it, the renderer waits for the data and `data` is always a value.
- **Error page** styles are injected, so they travel with its markup.
- **Forms:** `actionUrl(name?)` from `$droplets/form` gives where a form posts
  for an action in `+droplet.server.ts`, the same URL on the server and in
  the browser: `const add = actionUrl("add")` in `<script>`, then
  `<form method="post" action={add}>`. Such a form posts as any form does.
  The action `use:enhanceDropletForm` from
  `@dropletsjs/renderer-svelte/form` opts it in to progressive
  enhancement: the submit goes by `fetch` and the droplet shows the result
  in place. See [Actions](https://dropletsjs.dev/guides/actions/).

## Options

```ts
svelte({
  plugin: true,        // false: register @sveltejs/vite-plugin-svelte yourself
  vitePlugin: {},      // merged into the plugin's options (compilerOptions, preprocess, …)
});
```

Runes mode and `vitePreprocess()` are on by default. With `plugin: false`,
give `+error.svelte` files `css: "injected"` through `dynamicCompileOptions`.
Needs Svelte 5.5 or later.

MIT

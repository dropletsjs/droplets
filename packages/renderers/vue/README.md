# @dropletsjs/renderer-vue

The Vue 3 renderer for [Droplets](https://dropletsjs.dev): `+droplet.vue` and
`+error.vue` single-file components, rendered with `vue/server-renderer` and
hydrated or mounted in the browser.

The docs page, with a live droplet: [Vue](https://dropletsjs.dev/renderers/vue/).

```bash
pnpm add @dropletsjs/renderer-vue@alpha vue
```

```ts
// vite.config.ts
import { droplets } from "@dropletsjs/droplets/vite";
import { vue } from "@dropletsjs/renderer-vue";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [vue()] })],
});
```

```vue
<!-- src/droplets/hello/+droplet.vue -->
<script lang="ts">
export const hydrate = true; // flags: ssr, hydrate, prerender
</script>

<script setup lang="ts">
import { ref } from "vue";
import type { DropletProps } from "@dropletsjs/renderer-vue";
import { DropletChildren } from "@dropletsjs/renderer-vue/children";

const props = defineProps<DropletProps<{ greeting: string }>>();
// A value when hydrating, a promise when mounted from scratch.
const { greeting } = await props.data;
const clicks = ref(0);
</script>

<template>
  <h1>{{ greeting }}</h1>
  <button @click="clicks += 1">{{ clicks }}</button>
  <DropletChildren />
</template>
```

```vue
<!-- src/droplets/hello/+error.vue -->
<script setup lang="ts">
import { DropletChildren } from "@dropletsjs/renderer-vue/children";
defineProps<{ error: { message: string } }>();
</script>

<template>
  <p>{{ error.message }}</p>
  <DropletChildren />
</template>
```

- **Flags** are literal exports in a plain `<script>` next to `<script setup>`.
- **Children:** `<DropletChildren />` renders the host's content (`<slot>` in a
  Vue template is Vue's own slot).
- **Data as a promise:** the component runs inside `<Suspense>`, so
  `await props.data` works; a rejection reaches the renderer's error boundary.
- **Styles:** SFC `<style>` blocks, scoped included, reach the droplet's
  stylesheet. `+error.vue` compiles in custom-element mode, so its styles are
  inlined and travel with the markup.
- **Forms:** `actionUrl(name?)` from `$droplets/form` gives where a form posts
  for an action in `+droplet.server.ts`, the same URL on the server and in
  the browser: `const add = actionUrl("add")` in `<script setup>`, then
  `<form method="post" :action="add">`. Such a form posts as any form does.
  The composable `useEnhanceDropletForm(formRef, options?)` from
  `@dropletsjs/renderer-vue/form` opts it in to progressive
  enhancement: the submit goes by `fetch` and the droplet shows the result
  in place. See [Actions](https://dropletsjs.dev/guides/writing-droplets/#actions).

## Options

```ts
vue({
  plugin: true,     // false: register @vitejs/plugin-vue yourself
  vitePlugin: {},   // options for @vitejs/plugin-vue
});
```

With `plugin: false`, give `+error.vue` files `features.customElement`.

MIT

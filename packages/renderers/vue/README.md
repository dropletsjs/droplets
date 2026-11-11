# @dropletsjs/renderer-vue

The Vue 3 renderer for [Droplets](https://dropletsjs.dev): `+droplet.vue` and
`+error.vue` single-file components, rendered with `vue/server-renderer` and
hydrated or mounted in the browser. It compiles them with `@vitejs/plugin-vue`.

The docs page, with a live droplet: [Vue](https://dropletsjs.dev/renderers/vue/).

```bash
pnpm add @dropletsjs/renderer-vue@alpha vue
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { node } from "@dropletsjs/adapter-node";
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
import type { DropletProps } from "./$types"; // data: what +droplet.server.ts's load returns
import { DropletChildren } from "@dropletsjs/renderer-vue/children";

const props = defineProps<DropletProps>();
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

## Details

### Options

```ts
vue({
  plugin: true,   // false: register @vitejs/plugin-vue yourself
  vitePlugin: {}, // options for @vitejs/plugin-vue
});
```

`features.customElement` (or the older top-level `customElement`) is combined
with the error page pattern; every other key is passed as you give it. With
`plugin: false`, give `+error.vue` files `features.customElement`, so their
styles are inlined.

### Components

- **Flags** are literal exports in a plain `<script>` next to
  `<script setup>` (both blocks share their `lang`). Comments, `<script setup>`
  and the template never count.
- **Children:** `<DropletChildren />` from `@dropletsjs/renderer-vue/children`
  renders the host's content (`<slot>` in a Vue template is Vue's own slot).
  It may sit under a `v-if`; the content is moved out and back, never
  destroyed.
- **Data as a promise:** the component runs inside `<Suspense>`, so
  `await props.data` works; with an error page, a rejection (or any render
  error) reaches the renderer's error boundary, which shows `+error.vue` with
  what `handleError` made of it.
- **Styles:** SFC `<style>` blocks, scoped included, reach the droplet's
  stylesheet. `+error.vue` compiles in custom-element mode, so its styles are
  inlined and travel with the markup: in the fragment's `head` on the server,
  moved to `<style data-droplets-vue>` in the document head in the browser.
- **Forms:** `actionUrl(name?)` from `$droplets/form` gives where a form posts
  for an action in `+droplet.server.ts`, the same URL on the server and in
  the browser: `const add = actionUrl("add")` in `<script setup>`, then
  `<form method="post" :action="add">`. Such a form posts as any form does.
  The composable `useEnhanceDropletForm(formRef, options?)` from
  `@dropletsjs/renderer-vue/form` opts it in to progressive enhancement: the
  submit goes by `fetch` and the droplet shows the result in place. See
  [Actions](https://dropletsjs.dev/guides/actions/).

Under `vite dev`, a load edit patches a live droplet's props and keeps its
state, unless its `setup` awaited `data`: that one remounts.

### Changing this package

`pnpm --filter @dropletsjs/renderer-vue build` runs tsdown, then the tests,
which import `dist/`. `./children` and `./form` are client entries: they
import only `vue` and `@dropletsjs/droplets/enhance`.

## Facts

- `vue()` name is `"vue"`. `src/index.ts:98`
- `vue()` extensions are `[".vue"]`: it claims `+droplet.vue` and `+error.vue`. `src/index.ts:99`
- `vue()` packages are `vue` and `@dropletsjs/renderer-vue`: another renderer's droplet that imports either fails the build. `src/index.ts:101`, `../../droplets/src/vite/renderer-graphs.ts:62`
- `vue()` sets no `suffixes` and no `clientSetup`. `src/index.ts:97`
- `vue()` componentTypes is `@dropletsjs/renderer-vue`: `./$types` takes `DropletProps` and `DropletErrorProps` from it. `src/index.ts:102`, `../../droplets/src/vite/sync-types.ts:37`
- `vue()` server, client and clientDev are `dist/server.js`, `dist/client.js`, `dist/client-dev.js` under the package root. `src/index.ts:104`
- `vue()` plugins are one `@vitejs/plugin-vue`; `plugin: false` leaves `plugins` unset. `src/index.ts:103`
- `vitePlugin` keys other than `customElement` and `features.customElement` reach `@vitejs/plugin-vue` as given. `src/index.ts:84`
- `vitePlugin.features.customElement` wins over the top-level `vitePlugin.customElement`, which is never passed on. `src/index.ts:84`, `src/index.ts:93`
- Error page pattern `/[\\/]\+[Ee]rror\.vue$/` is added to the user's `customElement` patterns; `customElement: true` keeps every component in custom-element mode. `src/index.ts:69`, `src/index.ts:76`
- `readFlags` reads only the plain `<script>` block, from `vue/compiler-sfc`'s `parse`. `src/index.ts:34`
- `readFlags` parses the block as TSX for `lang="tsx"` or `lang="jsx"`, as TypeScript otherwise. `src/index.ts:38`
- `readFlags` returns `undefined` for a component without a plain `<script>`. `src/index.ts:35`
- `readFlags` ignores flags in comments, `<script setup>` and the template. `test/index.test.ts:54`
- `DropletProps` has `data` (a promise when mounted, the value when hydrated) and `form?`; no `children`. `src/index.ts:42`
- Server `render` uses `createSSRApp(component, props)` and `renderToString` of `vue/server-renderer`. `src/server.ts:26`, `src/server.ts:28`
- Server `render` provides `null` as the children host: `DropletChildren` renders the bare marker. `src/server.ts:27`
- Server `render` of an error page returns `{ html, head }` with one `<style>` per entry of the component's `styles`; plain HTML when it has none. `src/server.ts:33`
- Server `render` throws `<droplet>: the <kind> component is not a Vue component` when the default export is neither an object nor a function. `src/server.ts:18`
- Children marker is `<div data-droplet-children style="display: contents">`, inside a fragment root, so it never inherits a scoped-style attribute. `src/children.ts:38`, `src/children.ts:49`
- Children host reaches `DropletChildren` through app-level `provide`, under `Symbol.for("droplets:vue:children")`. `src/children.ts:30`, `src/client.ts:111`
- `DropletChildren` calls `host.fill(marker)` in `onMounted` and `host.empty(marker)` in `onBeforeUnmount`, before Vue removes the DOM. `src/children.ts:42`, `src/children.ts:46`
- Client `mount` uses `createApp`; `hydrate` uses `createSSRApp`; the instance is the app. `src/client.ts:110`, `src/client.ts:125`
- Client root renders the component under `<Suspense>`, so `await props.data` in `<script setup>` works. `src/live-props.ts:18`
- Client `mount` with an error page wraps the root in `DropletBoundary` (`onErrorCaptured`): the first error goes through `handle`, the error page renders with its result, nothing while it runs or when it rejects. `src/client.ts:75`, `src/client.ts:104`
- Client `mount` and `hydrate` of an error page inject its `styles` into `document.head` as `<style data-droplets-vue>`, once per text. `src/client.ts:42`, `src/client.ts:64`
- Client `hydrate` moves the target's top-level `<style>` elements (an error page's `head`) into `document.head` first, so hydration finds no mismatch. `src/client.ts:56`, `src/client.ts:122`
- Client `unmount` calls `app.unmount()`. `src/client.ts:133`
- Client dev `update` sets the root's props and waits for `nextTick`; the component keeps its state. `src/client-dev.ts:16`
- Client dev `update` returns `false` when the component's `setup` is async (Vue's `asyncDep`), and core remounts. `src/client-dev.ts:15`
- Client dev `update` returns `false` for an app it did not mount. `src/client-dev.ts:12`
- `./form` exports `useEnhanceDropletForm(formRef, options?)`: it follows the ref with `watch` (`immediate`, `flush: "post"`) and stops with the component. `src/form.ts:46`, `src/form.ts:68`
- `./form` reads its options at each submit; without `onResult` it calls `result.update()`. `src/form.ts:63`
- Package exports are `.`, `./server`, `./client`, `./children`, `./form`, `./package.json`. `package.json:23`
- Dependency is `@vitejs/plugin-vue` `^6.0.0`; peers are `@dropletsjs/droplets`, `vue` `^3.5.0`, `vite` `^8.0.0`. `package.json:62`, `package.json:65`
- Node engine is `>=22`. `package.json:51`
- Build script runs tsdown, then the tests. `package.json:54`
- Typecheck is `vue-tsc`. `package.json:58`
- tsdown entries are `index`, `server`, `client`, `client-dev`, `children`, `form`. `tsdown.config.ts:6`
- graphCheck client entries are `client`, `client-dev`, `children`, `form`; server modules `index`, `server`. `tsdown.config.ts:9`
- Suite runs on `rendererTests` from `@dropletsjs/shared/vitest` (happy-dom). `vitest.config.ts:1`

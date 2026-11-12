# @dropletsjs/renderer-svelte

The Svelte 5 renderer for [Droplets](https://dropletsjs.dev): `+droplet.svelte`
and `+error.svelte`, rendered on the server and hydrated or mounted in the
browser. It compiles them with `@sveltejs/vite-plugin-svelte`, in runes mode.

The docs page, with a live droplet: [Svelte](https://dropletsjs.dev/renderers/svelte/).

```bash
pnpm add @dropletsjs/renderer-svelte@alpha svelte
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { node } from "@dropletsjs/adapter-node";
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

## Details

### Options

```ts
svelte({
  plugin: true,   // false: register @sveltejs/vite-plugin-svelte yourself
  vitePlugin: {}, // merged into the plugin's options (compilerOptions, preprocess, …)
});
```

Runes mode and `vitePreprocess()` are on by default. `compilerOptions` and
`preprocess` from `vitePlugin` are combined with them (your preprocessors run
after `vitePreprocess()`); any other key replaces the default. With
`plugin: false`, register the plugin with runes mode and `vitePreprocess()`
and give `+error.svelte` files `css: "injected"` through
`dynamicCompileOptions`. Needs Svelte 5.5 or later.

### Components

- **Flags** are literal exports in `<script module>` (or
  `<script context="module">`). Nothing else in the file counts: not the
  instance `<script>`, the markup, a `<style>` block or an HTML comment.
- **Children:** `{@render children?.()}` renders the host's content. It may
  sit under an `{#if}`; the content is moved out and back, never destroyed.
- **Error page** styles are injected, so they travel with its markup: on the
  server in the fragment's `head`, in the browser when it mounts.
- **Forms:** `actionUrl(name?)` from `$droplets/form` gives where a form posts
  for an action in `+droplet.server.ts`, the same URL on the server and in
  the browser: `const add = actionUrl("add")` in `<script>`, then
  `<form method="post" action={add}>`. Such a form posts as any form does.
  The action `use:enhanceDropletForm` from `@dropletsjs/renderer-svelte/form`
  opts it in to progressive enhancement: the submit goes by `fetch` and the
  droplet shows the result in place. See
  [Actions](https://dropletsjs.dev/guides/actions/).

### Data as a promise

The renderer never turns on `experimental.async`; it reads whether you did
(in `svelte.config.js` or `vitePlugin`) from vite-plugin-svelte's resolved
options.

- With async mode on, a droplet mounted from scratch gets `data` as a
  promise: `{(await data).greeting}`. With an error page, the droplet renders
  under the renderer's `<svelte:boundary>`, and a rejection (or any render
  error) shows `+error.svelte` with what `handleError` made of it.
- Without it, `mount` waits for the data and `data` is always the value. A
  rejection mounts `+error.svelte` instead, or nothing when `handleError`
  rejects too.
- A hydrated droplet always gets the value.
- `DropletProps` types `data` as the value: `{data.greeting}` type-checks,
  and so do `{(await data).greeting}` and `{#await data then …}`, which read
  it in both modes.

Under `vite dev`, a load edit reaches a live droplet through `update`: its
`data` and `form` change in place and the component keeps its state.

### Changing this package

`pnpm --filter @dropletsjs/renderer-svelte build` runs tsdown, then the
tests, which import `dist/`. `children.svelte`, `boundary.svelte` and
`form.svelte.js` ship as source (tsdown copies them) and are compiled by the
consumer's vite-plugin-svelte. The conformance kit runs twice: with async
mode and without it, on a copy of the fixture in `test/fixtures/.app-sync`.
`svelte.config.js` here only turns async mode on for `svelte-check`.

## Facts

- `svelte()` name is `"svelte"`. `src/index.ts:136`
- `svelte()` extensions are `[".svelte"]`: it claims `+droplet.svelte` and `+error.svelte`. `src/index.ts:137`
- `svelte()` packages are `svelte` and `@dropletsjs/renderer-svelte`: another renderer's droplet that imports either fails the build. `src/index.ts:139`, `../../droplets/src/vite/renderer-graphs.ts:62`
- `svelte()` suffixes are `.svelte.ts` and `.svelte.js` (rune modules): another renderer's droplet that imports one fails the build. `src/index.ts:142`, `../../droplets/src/vite/renderer-graphs.ts:62`
- `svelte()` componentTypes is `@dropletsjs/renderer-svelte`: `./$types` takes `DropletProps` and `DropletErrorProps` from it. `src/index.ts:140`, `../../droplets/src/vite/sync-types.ts:37`
- `svelte()` server, client and clientDev are `dist/server.js`, `dist/client.js`, `dist/client-dev.js` under the package root. `src/index.ts:144`
- `svelte()` sets no `clientSetup`. `src/index.ts:135`
- `svelte()` plugins are `@sveltejs/vite-plugin-svelte` then `droplets:svelte-options`; `plugin: false` leaves only `droplets:svelte-options`. `src/index.ts:143`, `test/index.test.ts:33`
- `vitePlugin` keys other than `compilerOptions`, `preprocess` and `dynamicCompileOptions` replace the renderer's defaults. `src/index.ts:123`
- `vitePlugin.compilerOptions` is spread over `{ runes: true }`: runes mode is on unless set otherwise. `src/index.ts:124`
- `vitePlugin.preprocess` runs after `vitePreprocess()`, as an array or a single preprocessor. `src/index.ts:115`
- `+error.svelte` (or `+Error.svelte`) compiles with `css: "injected"`; the user's `dynamicCompileOptions` result is spread after it. `src/index.ts:84`, `src/index.ts:129`
- `readFlags` lives in `src/flags.ts` and reaches core on the renderer object; the package entry does not export it. `src/flags.ts:9`, `src/index.ts:118`
- `readFlags` reads only the `<script module>` or `<script context="module">` block, split by Svelte's `preprocess`. `src/flags.ts:13`, `src/flags.ts:17`
- `readFlags` parses the module block as TypeScript, whatever its `lang`. `src/flags.ts:27`
- `readFlags` returns `undefined` for a component without a module block. `src/flags.ts:24`
- `readFlags` ignores flags in HTML comments, JS comments, the instance `<script>`, the markup and `<style>`. `test/index.test.ts:47`
- Flags exported from `+droplet.ts` or `+droplet.server.ts` are ignored, in a build and in `vite dev`. `test/integration/flags.test.ts:77`
- `experimental.async` is never set by the renderer; `droplets:svelte-options` reads it in `configResolved` from the `vite-plugin-svelte:config` plugin's `api.options`. `src/index.ts:103`
- Async mode reaches the browser as `asyncMode`, exported by `virtual:droplets-renderer-svelte/options`. `src/index.ts:87`, `src/index.ts:109`
- Server `render` awaits `svelte/server`'s `render`, so components with top-level `await` render. `src/server.ts:18`
- Server `render` passes the `marker` snippet of `children.svelte` as `children`. `src/server.ts:9`, `src/server.ts:18`
- Server `render` of an error page returns `{ html, head }`, with the injected `<style>` in `head`. `src/server.ts:22`
- Server `render` of a droplet returns the body only: `<svelte:head>` is dropped. `src/server.ts:22`
- Server `render` throws `<droplet>: the <kind> component is not a Svelte component` when the default export is not a function. `src/server.ts:13`
- Children marker is `<div data-droplet-children style="display: contents" use:fill out:release|global>`. `src/children.svelte:15`
- Children host reaches the marker through Svelte's context, under `Symbol.for("droplets:svelte:children")`. `src/children.ts:20`, `src/client.ts:35`
- Children `use:fill` calls `host.fill(marker)`; the `out:release|global` transition calls `host.empty(marker)` with duration 0, before Svelte removes the marker. `src/children.ts:28`, `src/children.ts:37`
- Client `mount` without async mode awaits `data` before it mounts the droplet. `src/client.ts:49`, `src/client.ts:76`
- Client `mount` without async mode, `data` rejected and an error page: mounts `+error.svelte` with `{ error: await handle(error) }`; `null` and nothing mounted when `handle` rejects. `src/client.ts:81`, `src/client.ts:84`
- Client `mount` without async mode, `data` rejected and no error page: the returned promise rejects with the error. `src/client.ts:78`
- Client `mount` after the await runs inside `context.rendering` when it is set. `src/client.ts:100`
- Client `mount` in async mode with an error page renders the droplet under `boundary.svelte`'s `<svelte:boundary>`; a failure shows `+error.svelte` with `handle(error)`, nothing while `handle` runs or when it rejects. `src/client.ts:54`, `src/boundary.svelte:41`, `src/boundary.svelte:44`
- Client `mount` in async mode without an error page hands the component `data` as the promise. `src/client.ts:65`
- Boundary: a rejected `data` takes the host's container out of the marker first, and puts it back on the next task when the marker is still connected. `src/boundary.svelte:35`, `src/children.ts:50`
- Client `mount` of an error page (`{ error }` props) mounts it directly, with no live props. `src/client.ts:50`
- Client `hydrate` uses `svelte`'s `hydrate`; `data` is the value the server rendered with. `src/client.ts:104`
- Live props: `data` and `form` are getters over a `SvelteMap`; an update sets them in place and deletes one the new props lack. `src/live-props.ts:27`, `src/live-props.ts:38`
- Client dev `update` returns `false` for an instance without live props (an error page), and core remounts. `src/client-dev.ts:13`
- Client dev `update` without async mode awaits the new `data` before setting it. `src/client-dev.ts:14`
- Client `unmount` calls `svelte`'s `unmount`, and skips `null`. `src/client.ts:117`
- `./form` exports `enhanceDropletForm`, a Svelte action over `enhanceDropletForm` of `@dropletsjs/droplets/enhance`; its options follow the action's `update`. `src/form.svelte.js:28`, `src/form.svelte.js:39`
- `./form` without `onResult` calls `result.update()`. `src/form.svelte.js:35`
- `./form` ships as source with a `svelte` export condition. `package.json:36`
- `.svelte` files and `form.svelte.js` are copied to `dist/` as is, for the consumer's vite-plugin-svelte. `tsdown.config.ts:9`
- tsdown never bundles a `.svelte` import. `tsdown.config.ts:7`
- graphCheck client entries are `client`, `client-dev`, `children`; server modules `index`, `server`. `tsdown.config.ts:19`
- Package exports are `.`, `./server`, `./client`, `./form`, `./package.json`. `package.json:23`
- Dependency is `@sveltejs/vite-plugin-svelte` `^7.3.1`; peers are `@dropletsjs/droplets`, `svelte` `^5.5.0`, `vite` `^8.0.0`. `package.json:59`, `package.json:62`
- Node engine is `>=22`. `package.json:48`
- Build script runs tsdown, then the tests. `package.json:51`
- Typecheck is `svelte-check --fail-on-warnings`. `package.json:55`
- `svelte.config.js` in this package turns async mode on for `svelte-check` only; Vite reads none of it. `svelte.config.js:3`
- `DropletProps.data` is `Data`, the value; `test/types/droplet-props.svelte` reads it directly, with `await` and with `{#await}`, under `svelte-check`. `src/index.ts:63`, `test/types/droplet-props.svelte:9`
- Conformance runs with async mode in `test/conformance.test.ts` and without it in `test/conformance-sync.test.ts`, on a copy of the fixture in `test/fixtures/.app-sync`. `test/conformance.test.ts:11`, `test/conformance-sync.test.ts:11`
- Suite runs on `rendererTests` from `@dropletsjs/shared/vitest` (happy-dom). `vitest.config.ts:1`

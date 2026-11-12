# @dropletsjs/renderer-hono-jsx

The Hono JSX renderer for [Droplets](https://dropletsjs.dev): `+droplet.tsx`
and `+error.tsx` (or `.jsx`) written with `hono/jsx`, the JSX Hono ships.
Rendered to a string on the server and with `hono/jsx/dom` in the browser.
No framework package beyond `hono`.

The docs page, with a live droplet: [Hono JSX](https://dropletsjs.dev/renderers/hono-jsx/).

```bash
pnpm add @dropletsjs/renderer-hono-jsx hono
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { node } from "@dropletsjs/adapter-node";
import { honoJsx } from "@dropletsjs/renderer-hono-jsx";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [honoJsx()] })],
});
```

## Details

### Components

```tsx
// src/droplets/hello/+droplet.tsx
import { use, useState } from "hono/jsx";
import type { DropletProps } from "./$types"; // data: what +droplet.server.ts's load returns

export const hydrate = true; // flags: ssr, hydrate, prerender

export default function Hello({ data, children }: DropletProps) {
  const [clicks, setClicks] = useState(0);
  // A value when hydrating, a promise when mounted from scratch.
  const { greeting } = data instanceof Promise ? use(data) : data;
  return (
    <>
      <h1>{greeting}</h1>
      <button onClick={() => setClicks((n) => n + 1)}>{clicks}</button>
      {children}
    </>
  );
}
```

```tsx
// src/droplets/hello/+error.tsx
import type { DropletErrorProps } from "@dropletsjs/renderer-hono-jsx";

export default function HelloError({ error, children }: DropletErrorProps<{ message: string }>) {
  return (
    <>
      <p class="oops">{error.message}</p>
      {children}
    </>
  );
}
```

- **Flags** are literal named exports; the component is the default export.
- **Imports:** hooks, `use`, `Suspense` and `ErrorBoundary` come from
  `hono/jsx` on both sides; in the browser the renderer resolves `hono/jsx`
  to `hono/jsx/dom`. Attributes are HTML's: `class`, not `className`.
- **Compiled per environment** with the automatic JSX runtime of `hono/jsx`
  on the server and of `hono/jsx/dom` in the browser. tsconfig wants
  `"jsx": "react-jsx"` and `"jsxImportSource": "hono/jsx"`.
- **Hydration renders again.** `hono/jsx/dom` cannot adopt server markup, so
  `hydrate` replaces the server's HTML with a fresh render, in the same task:
  the page never shows a gap, but what the visitor did before the bundle
  loaded (a typed value, focus, a click) does not survive.
- **Data as a promise:** `use(data)` suspends; a rejection reaches the
  renderer's error boundary. Async components render on the server only.
- **Styles:** imported CSS reaches the droplet's stylesheet.
- **Forms:** `actionUrl(name?)` from `$droplets/form` gives where a form posts
  for an action in `+droplet.server.ts`, the same URL on the server and in
  the browser: keep it from the first render,
  `const [add] = useState(() => actionUrl("add"))`, then
  `<form method="post" action={add}>`. Such a form posts as any form does.
  `useEnhanceDropletForm(formRef, options?)` from
  `@dropletsjs/renderer-hono-jsx/form` opts it in to progressive
  enhancement: the submit goes by `fetch` and the droplet shows the result
  in place. See [Actions](https://dropletsjs.dev/guides/actions/).
- **Under `vite dev`** new props render into the same root: Hono reconciles
  the tree and the component keeps its state. An edit to the component
  remounts the droplet in place, without a page reload.
- React, Preact and Solid claim `.tsx` and `.jsx` too, and all four can share
  a project: a droplet's framework is the one its file imports (`hono/jsx`,
  `react`, `preact`, `solid-js`), or a `/** @jsxImportSource hono/jsx */` comment.
  Importing `hono` itself (a client, `hono/cookie`) says nothing. See
  [Several frameworks in one project](https://dropletsjs.dev/renderers/#several-frameworks-in-one-project).

### Options

```ts
honoJsx({
  plugin: true, // false: compile the components yourself
});
```

With `plugin: false`, the server build needs `hono/jsx` as the JSX import
source, and the browser build `hono/jsx/dom`, with `hono/jsx` resolving to
`hono/jsx/dom` there.

### How it renders

- Server (`src/server.ts`): the component as a `hono/jsx` node, printed
  with `toString()`, which awaits async components. `children` is an
  element that prints the empty marker.
- Browser (`src/client.ts`, `src/tree.ts`): `createRoot` of
  `hono/jsx/dom/client`. The component renders under `<Suspense>`, and
  under an `<ErrorBoundary>` when the droplet has an error page; what throws
  goes through the droplet's `handleError` into `+error.tsx`.
- `hydrate` empties the element and mounts: the server's nodes are
  replaced, so clicks held before hydration have no node to reach.
- The plugin (`src/plugin.ts`) compiles `.tsx`/`.jsx` with oxc before Vite's
  own transform would apply React's runtime.

### Changing this package

`pnpm --filter @dropletsjs/renderer-hono-jsx build` runs tsdown, then the
tests under happy-dom: the conformance kit (`rendererConformance()` with
`adopts: false`) and `test/index.test.ts` use `dist/`. One test file per
source file: `index`, `plugin`, `server`, `client` (which covers `tree.ts`
through `mount`).

## Facts

- `honoJsx()` returns the renderer named `hono-jsx`, claiming `.tsx` and `.jsx`. `src/index.ts:72`, `src/index.ts:73`
- `honoJsx()` packages are `hono/jsx` and `@dropletsjs/renderer-hono-jsx`, not `hono`: importing `hono` does not make a file Hono JSX's. `src/index.ts:75`, `../../droplets/src/renderer.ts:692`
- `honoJsx()` componentTypes is `@dropletsjs/renderer-hono-jsx`: `./$types` takes `DropletProps` and `DropletErrorProps` from this package. `src/index.ts:76`, `../../droplets/src/vite/sync-types.ts:37`
- `honoJsx({ plugin: false })` adds no Vite plugin. `src/index.ts:78`
- `honoJsx()` passes core's scope filter to its plugin as `include` (another renderer shares `.tsx`). `src/index.ts:78`
- `honoJsx()` server, client and clientDev are `dist/server.js`, `dist/client.js` and `dist/client-dev.js`, found by path; no clientSetup. `src/index.ts:79`, `src/index.ts:81`
- `honoJsx()` has no `readFlags`: core's default reader takes flags from the component's literal named exports. `../../droplets/src/core/discover.ts:146`, `test/index.test.ts:29`
- `DropletProps` data is `Data | Promise<Data>`; children is a Hono `Child`. `src/index.ts:48`, `src/index.ts:51`
- Plugin is named `droplets:hono-jsx` and runs with `enforce: "pre"`. `src/plugin.ts:32`, `src/plugin.ts:33`
- Plugin resolveId maps `hono/jsx`, `hono/jsx/jsx-runtime` and `hono/jsx/jsx-dev-runtime` to their `hono/jsx/dom` builds, in the client environment only. `src/plugin.ts:17`, `src/plugin.ts:39`
- Plugin DOM build lookup is a `Map`: a specifier that names an `Object.prototype` member finds nothing. `src/plugin.ts:38`
- Plugin transform compiles `.tsx`/`.jsx` outside `node_modules` with oxc, automatic runtime, `hono/jsx/dom` in the browser and `hono/jsx` elsewhere. `src/plugin.ts:46`, `src/plugin.ts:51`
- Plugin transform skips a module `include` does not match, when `include` is set. `src/plugin.ts:47`
- Plugin transform emits a source map. `src/plugin.ts:52`
- Server render prints `jsx(component, { ...props, children })` with `toString()`, awaiting async components. `src/server.ts:28`
- Server children is `<div data-droplet-children="" style="display: contents"></div>`. `src/server.ts:27`, `test/server.test.ts:13`
- Server and client throw `<droplet>: the <kind> component is not a Hono JSX component` when the default export is not a function. `src/server.ts:20`, `src/tree.ts:26`
- Client mount uses `createRoot` of `hono/jsx/dom/client`; the instance is `{ root, component, context }`. `src/client.ts:26`, `src/client.ts:28`
- Client hydrate empties the target and mounts: the server's nodes are replaced, not adopted. `src/client.ts:33`, `src/client.ts:34`
- Client unmount flushes `root.unmount()` with `flushSync`, so the target is empty when it returns. `src/client.ts:40`
- Client tree is always under `<Suspense>` with an empty fragment as fallback, never `null`. `src/tree.ts:101`, `src/tree.ts:17`
- Client tree adds `<ErrorBoundary>` only when the droplet has an error page. `src/tree.ts:105`, `src/tree.ts:107`
- Error boundary passes the error to `handle` (the droplet's `handleError`) once per error; nothing renders while it runs or when it rejects. `src/tree.ts:66`, `src/tree.ts:68`, `src/tree.ts:73`
- Data promise is wrapped so Hono's `<Suspense>` `finally` leaves no unhandled rejection. `src/tree.ts:87`, `src/tree.ts:91`
- Children marker is filled in a layout effect and emptied in its cleanup, while still in the document. `src/tree.ts:44`, `src/tree.ts:45`
- `update` (clientDev) renders the tree with new props into the same root, flushed; it always answers true. `src/client-dev.ts:10`, `src/client-dev.ts:11`
- `useEnhanceDropletForm(formRef, options?)` of `./form` enhances the form once mounted and releases it with the effect. `src/form.ts:48`, `src/form.ts:51`
- `useEnhanceDropletForm` reads its options at each submit; without `onResult` it calls the result's `update()`. `src/form.ts:46`, `src/form.ts:56`
- Package exports are `.`, `./server`, `./client` and `./form`. `package.json:24`
- Peers are `@dropletsjs/droplets`, `hono ^4.13.0` and `vite ^8.0.0`; no dependencies. `package.json:59`
- Node engine is `>=22`. `package.json:48`
- Build script runs tsdown, then the tests. `package.json:51`
- graphCheck: client entries `client`, `client-dev`, `form`; server `index`, `server`, `plugin`. `tsdown.config.ts:9`, `tsdown.config.ts:10`
- Conformance runs with `adopts: false`: hydration renders again. `test/conformance.test.ts:12`
- Tests run under happy-dom through `rendererTests` of `@dropletsjs/shared/vitest`. `vitest.config.ts:1`

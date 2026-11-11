# @dropletsjs/renderer-solid

The Solid renderer for [Droplets](https://dropletsjs.dev): `+droplet.tsx` and
`+error.tsx` (or `.jsx`), rendered on the server with `solid-js/web` and
hydrated or mounted in the browser. Several Solid droplets on one page
hydrate independently, and the host page needs no script of Solid's.

The docs page, with a live droplet: [Solid](https://dropletsjs.dev/renderers/solid/).

```bash
pnpm add @dropletsjs/renderer-solid@alpha solid-js
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { node } from "@dropletsjs/adapter-node";
import { solid } from "@dropletsjs/renderer-solid";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [solid()] })],
});
```

## Details

### Components

```tsx
// src/droplets/hello/+droplet.tsx
import { createResource, createSignal } from "solid-js";
import type { DropletProps } from "./$types"; // data: what +droplet.server.ts's load returns

export const hydrate = true; // flags: ssr, hydrate, prerender

export default function Hello(props: DropletProps) {
  const [clicks, setClicks] = createSignal(0);
  // A value when hydrating, a promise when mounted from scratch.
  const data = props.data;
  const value = data instanceof Promise ? createResource(() => data)[0] : () => data;
  return (
    <>
      <h1>{value()?.greeting}</h1>
      <button onClick={() => setClicks(clicks() + 1)}>{clicks()}</button>
      {props.children}
    </>
  );
}
```

```tsx
// src/droplets/hello/+error.tsx
import type { DropletErrorProps } from "@dropletsjs/renderer-solid";

export default (props: DropletErrorProps<{ message: string }>) => (
  <>
    <p>{props.error.message}</p>
    {props.children}
  </>
);
```

- **Flags** are literal named exports of the component file; the component
  is the default export.
- **Children:** `props.children` renders the host's content.
- **Data as a promise:** a resource of it suspends; one that rejects reaches
  the renderer's error boundary, which shows `+error.tsx`.
- **Forms:** `actionUrl(name?)` from `$droplets/form` gives where a form posts
  for an action in `+droplet.server.ts`, the same URL on the server and in
  the browser: `const add = actionUrl("add")` in the component, then
  `<form method="post" action={add}>`. Such a form posts as any form does.
  The directive `use:enhanceDropletForm` from
  `@dropletsjs/renderer-solid/form` opts it in to progressive
  enhancement: the submit goes by `fetch` and the droplet shows the result
  in place. See [Actions](https://dropletsjs.dev/guides/actions/).
- **Hydration** is keyed by the droplet's render id, so several Solid droplets
  on a page hydrate independently. The renderer sets up Solid's hydration
  state itself; hosts need no script.
- Solid, React, Preact and Hono JSX all claim `.tsx` and `.jsx` and can share
  a project: a droplet's framework is the one its file imports (`react`,
  `preact`, `solid-js` or `hono/jsx`), or a `/** @jsxImportSource … */` comment. See
  [Several frameworks in one project](https://dropletsjs.dev/renderers/#several-frameworks-in-one-project).

### Options

```ts
solid({
  plugin: true,     // false: register vite-plugin-solid yourself (with ssr: true)
  vitePlugin: {},   // options for vite-plugin-solid; ssr is always true
});
```

Keep `solid.hydratable` of `vite-plugin-solid` at its default: the server
markup is hydrated by key.

### How it renders

- Server (`src/server.ts`): `renderToString` with core's `renderId`, so the
  hydration keys of two droplets on one page never meet. `children` prints
  the empty marker `<div data-droplet-children style="display: contents">`
  as a raw node, without a hydration key.
- Browser mount (`src/client.ts`): `render` of `solid-js/web`. With an error
  page, the component renders under `<Suspense>` inside an `<ErrorBoundary>`;
  what throws goes through the droplet's `handleError`, and the error page
  renders in its place.
- Browser hydrate: `hydrate` of `solid-js/web` with the same `renderId`,
  adopting the server's children markers in document order.
- `src/client-setup.ts` defines Solid's page state `window._$HY` with event
  replay off: core holds the clicks that arrive before a droplet hydrates
  and replays them itself.
- Under `vite dev`, `src/client-dev.ts` sets new props through a signal:
  the component keeps its state.

### Changing this package

`pnpm --filter @dropletsjs/renderer-solid build` runs tsdown, then the
tests: the conformance kit (`rendererConformance()` of
`@dropletsjs/droplets/testing`) and `test/index.test.ts` use `dist/`. The
client tests run on Solid's browser builds under happy-dom; the factory and
server tests under Node. Every module core finds by path is a tsdown entry.

## Facts

- `solid()` returns the renderer named `solid`, claiming `.tsx` and `.jsx`. `src/index.ts:61`, `src/index.ts:62`
- `solid()` packages are `solid-js` and `@dropletsjs/renderer-solid`: a shared-extension file is Solid's when it imports one of them or names it in `@jsxImportSource`. `src/index.ts:63`, `../../droplets/src/renderer.ts:692`
- `solid()` componentTypes is `@dropletsjs/renderer-solid`: `./$types` takes `DropletProps` and `DropletErrorProps` from this package. `src/index.ts:64`, `../../droplets/src/vite/sync-types.ts:37`
- `solid()` forces `ssr: true` over the `vitePlugin` options. `src/index.ts:59`
- `solid({ plugin: false })` adds no Vite plugin. `src/index.ts:66`
- `solid()` passes core's scope filter as vite-plugin-solid's `include` when core sets one (another renderer shares `.tsx`). `src/index.ts:68`
- `solid()` server, client, clientDev and clientSetup are `dist/server.js`, `dist/client.js`, `dist/client-dev.js` and `dist/client-setup.js`, found by path. `src/index.ts:69`, `src/index.ts:73`
- `solid()` has no `readFlags`: core's default reader takes flags from the component's literal named exports. `../../droplets/src/core/discover.ts:146`
- `DropletProps` data is `Data | Promise<Data>`: a promise when mounted, the value when hydrated. `src/index.ts:30`
- Server render is `renderToString` with `renderId: context.renderId`. `src/server.ts:35`
- Server children is a raw `ssr()` node printing `<div data-droplet-children style="display: contents"></div>`, with no hydration key. `src/server.ts:16`
- Server and client throw `<droplet>: the <kind> component is not a Solid component` when the default export is not a function. `src/server.ts:25`, `src/client.ts:66`
- Client mount uses `render` of `solid-js/web`; the instance is Solid's dispose function. `src/client.ts:132`, `src/live-props.ts:6`
- Client mount wraps the component in `<ErrorBoundary>` and `<Suspense>` only when the droplet has an error page. `src/client.ts:132`, `src/client.ts:100`
- Error boundary passes what was thrown to `handle` (the droplet's `handleError`), unwrapping Solid's `new Error("Unknown error", { cause })`. `src/client.ts:103`, `src/client.ts:78`
- Error boundary renders nothing while `handle` runs or when it rejects. `src/client.ts:105`, `src/client.ts:107`
- Client hydrate uses `hydrate` of `solid-js/web` with `renderId: context.renderId`. `src/client.ts:152`
- Client hydrate resets `_$HY.done` and `sharedConfig.done` to false before each droplet. `src/client.ts:147`, `src/client.ts:148`
- Client hydrate hands out the server's children markers in document order; after hydration every new marker is fresh. `src/client.ts:140`, `src/client.ts:160`
- Children marker is filled in `onMount` and emptied in `onCleanup`, while still connected. `src/client.ts:55`, `src/client.ts:56`
- Children marker created in the browser is a `div` with `data-droplet-children` and `display: contents`. `src/client.ts:30`
- Component props are getters over one signal; a `form` getter is added when the props have `data` and no `form`. `src/live-props.ts:20`, `src/live-props.ts:25`
- `update` (clientDev) sets the props signal: same instance, state kept; it answers false for a handle it does not know. `src/client-dev.ts:6`, `src/client-dev.ts:8`
- `unmount` calls the dispose function. `src/client.ts:165`
- `_$HY` is defined by `client-setup.ts` on import as `{ events: null, completed: null, r: {}, fe() {} }`, only when the page has none. `src/client-setup.ts:29`, `src/client-setup.ts:33`
- `_$HY` events stay `null`: Solid's own replay of early events is off; core replays held clicks. `src/client-setup.ts:9`
- `enhanceDropletForm` of `./form` is a Solid directive, `use:enhanceDropletForm`; `true` or no value means no options. `src/form.ts:25`, `src/form.ts:28`
- `enhanceDropletForm` reads its options at each submit and is released in `onCleanup`. `src/form.ts:26`, `src/form.ts:30`
- `enhanceDropletForm` without `onResult` calls the result's `update()`. `src/form.ts:38`
- `JSX.Directives` of `solid-js` is augmented with `enhanceDropletForm: EnhanceOptions | true`. `src/form.ts:47`
- Package exports are `.`, `./server`, `./client` and `./form`. `package.json:23`
- Peers are `@dropletsjs/droplets`, `solid-js ^1.9.0` and `vite ^8.0.0`; `vite-plugin-solid ^2.11.0` is a dependency. `package.json:61`, `package.json:58`
- Node engine is `>=22`. `package.json:47`
- Build script runs tsdown, then the tests. `package.json:50`
- graphCheck: client entries `client`, `client-dev`, `client-setup`, `form`; server entries `index`, `server`. `tsdown.config.ts:9`, `tsdown.config.ts:10`
- Client unit tests alias `solid-js` and `solid-js/web` to their browser builds. `vitest.config.ts:9`, `vitest.config.ts:28`
- Conformance runs `rendererConformance()` on the built bundles under happy-dom. `test/conformance.test.ts:9`, `vitest.config.ts:36`

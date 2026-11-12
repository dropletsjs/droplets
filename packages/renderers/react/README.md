# @dropletsjs/renderer-react

The React 19 renderer for [Droplets](https://dropletsjs.dev): `+droplet.tsx`
and `+error.tsx` (or `.jsx`), rendered with `renderToString` and hydrated or
mounted in the browser. It compiles them with `@vitejs/plugin-react` and runs
Fast Refresh on any host page under `vite dev`.

The docs page, with a live droplet: [React](https://dropletsjs.dev/renderers/react/).

```bash
pnpm add @dropletsjs/renderer-react react react-dom
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { node } from "@dropletsjs/adapter-node";
import { react } from "@dropletsjs/renderer-react";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [react()] })],
});
```

```tsx
// src/droplets/hello/+droplet.tsx
import { use, useState } from "react";
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
import type { DropletErrorProps } from "@dropletsjs/renderer-react";

export default function HelloError({ error, children }: DropletErrorProps<{ message: string }>) {
  return (
    <>
      <p>{error.message}</p>
      {children}
    </>
  );
}
```

## Details

### Options

```ts
react({
  plugin: true,   // false: register @vitejs/plugin-react yourself
  vitePlugin: {}, // options for @vitejs/plugin-react
});
```

With `plugin: false`, `@vitejs/plugin-react` still has to be in the Vite
config: the Fast Refresh preamble comes from it.

### Components

- **Flags** are literal named exports; the component is the default export.
- **Children:** `children` renders the host's content.
- **Data as a promise:** `use(data)` suspends; a rejection reaches the
  renderer's error boundary, which shows `+error.tsx` with what
  `handleError` made of it.
- **Styles:** imported CSS reaches the droplet's stylesheet, an error
  page's included; nothing travels with the markup.
- **Forms:** `actionUrl(name?)` from `$droplets/form` gives where a form posts
  for an action in `+droplet.server.ts`, the same URL on the server and in
  the browser: keep it from the first render,
  `const [add] = useState(() => actionUrl("add"))`, then
  `<form method="post" action={add}>`. Such a form posts as any form does.
  `useEnhanceDropletForm(formRef, options?)` from
  `@dropletsjs/renderer-react/form` opts it in to progressive enhancement:
  the submit goes by `fetch` and the droplet shows the result in place. See
  [Actions](https://dropletsjs.dev/guides/actions/).
- On Workers, `react-dom/server` resolves to React's edge build.

### Fast Refresh

Under `vite dev` (`dev.strategy: "hmr"`, the default), an edit keeps
component state. The renderer installs the preamble itself, since a droplet
sits on someone else's page, and compiles refresh into React's modules
alone, never into another framework's (a Vue `<script lang="ts">`).

### Several JSX frameworks

Solid, React, Preact and Hono JSX all claim `.tsx` and `.jsx` and can share
a project: a droplet's framework is the one its file imports (`react`,
`preact`, `solid-js` or `hono/jsx`), or a `/** @jsxImportSource … */`
comment. See
[Several frameworks in one project](https://dropletsjs.dev/renderers/#several-frameworks-in-one-project).

### Changing this package

`pnpm --filter @dropletsjs/renderer-react build` runs tsdown, then the
tests, which import `dist/`. `src/refresh.ts` is server code (it runs in
Vite); `client-setup` is a client entry.

## Facts

- `react()` name is `"react"`. `src/index.ts:76`
- `react()` extensions are `[".tsx", ".jsx"]`. `src/index.ts:77`
- `react()` packages are `react`, `react-dom` and `@dropletsjs/renderer-react`: another renderer's droplet that imports one fails the build. `src/index.ts:78`, `../../droplets/src/vite/renderer-graphs.ts:62`
- `react()` sets no `suffixes`. `src/index.ts:75`
- `react()` componentTypes is `@dropletsjs/renderer-react`: `./$types` takes `DropletProps` and `DropletErrorProps` from it. `src/index.ts:79`, `../../droplets/src/vite/sync-types.ts:37`
- `react()` server, client, clientDev and clientSetup are `dist/server.js`, `dist/client.js`, `dist/client-dev.js`, `dist/client-setup.js` under the package root. `src/index.ts:96`, `src/index.ts:100`
- `react()` has no `readFlags`: core reads the named exports with `readExportedFlags`. `../../droplets/src/core/discover.ts:146`, `test/index.test.ts:46`
- `react()` plugins are a function of core's scope: `@vitejs/plugin-react`, then `droplets:react-refresh`; `plugin: false` leaves `plugins` unset. `src/index.ts:87`
- `react()` with `scope.include` (another renderer shares `.tsx`) sets plugin-react's `include` to it and `jsxImportSource` to `react`, unless `vitePlugin` names one. `src/index.ts:89`, `src/index.ts:91`
- `vitePlugin` options are spread into plugin-react's after the scope's `jsxImportSource`, before its `include`. `src/index.ts:90`
- `DropletProps` has `data` (a promise when mounted, the value when hydrated), `form?` and `children?`. `src/index.ts:49`
- `DropletErrorProps` has `error` and `children?`. `src/index.ts:57`
- Server `render` returns `renderToString` of the component with the props and the children element; never a `head`. `src/server.ts:33`
- Server `render` throws `<droplet>: the <kind> component is not a React component` for a default export that is neither a function nor a `$$typeof` object. `src/server.ts:26`
- `react-dom/server` resolves through its `exports` conditions: the Node build under Node, the edge build under `workerd` / `worker`. `src/server.ts:5`
- Children marker is `<div data-droplet-children style="display: contents">`, rendered by `DropletChildren`. `src/children.ts:32`
- Children host reaches `DropletChildren` through `ChildrenHostContext`, `null` on the server. `src/children.ts:20`, `src/tree.ts:69`
- `DropletChildren` calls `host.fill(marker)` in a layout effect and `host.empty(marker)` in its cleanup; it depends on the host alone. `src/children.ts:26`
- Under StrictMode the double effect fills, empties and fills again. `test/client.test.ts:72`
- Client `mount` uses `createRoot(...).render` and `hydrate` uses `hydrateRoot`, both inside `flushSync`: the component is committed when they return. `src/client.ts:52`, `src/client.ts:61`
- Client instance is `{ root, component, context }`; `unmount` calls `root.unmount()`. `src/client.ts:30`, `src/client.ts:66`
- Client root options log `onRecoverableError`, `onUncaughtError` and `onCaughtError` to `console.error` as `[droplets] <droplet> (<kind>, react)`. `src/client.ts:33`
- Client `onCaughtError` stays quiet for the droplet's own boundary: core reports what it shows. `src/client.ts:43`
- Client tree with an error page wraps the component in `<Suspense fallback={null}>` inside `DropletBoundary`. `src/tree.ts:61`
- `DropletBoundary` passes the error through `handle`, then renders the error page with the result and `children`; nothing while it runs or when it rejects. `src/tree.ts:43`, `src/tree.ts:51`
- Client dev `update` renders the same tree with new props inside `flushSync` and always returns `true`. `src/client-dev.ts:8`
- `droplets:react-refresh` runs under `vite dev` only (`apply: "serve"`, `enforce: "pre"`). `src/refresh.ts:69`
- `droplets:react-refresh` turns `oxc.jsx.refresh` off in the shared options, after plugin-react's `config` hooks. `src/refresh.ts:74`
- `droplets:react-refresh` does nothing in production or with `server.hmr: false`. `src/refresh.ts:87`
- `droplets:react-refresh` compiles with refresh on only client-environment modules that have JSX or import the JSX runtime. `src/refresh.ts:92`, `src/refresh.ts:97`
- `droplets:react-refresh` filter is `refreshInclude`, then core's `include`, then plugin-react's `include`, then `/\.[tj]sx?$/`; excluded `refreshExclude`, `exclude` or `/node_modules/`. `src/refresh.ts:57`
- `droplets:react-refresh` matches core's `include` against the full id (core marks with a query), plugin-react's against the file. `src/refresh.ts:95`
- Fast Refresh is off in the options other compilers share. `test/refresh.test.ts:47`
- `client-setup` imports `@vitejs/plugin-react/preamble`, which is empty in a build or with HMR off. `src/client-setup.ts:23`
- `client-setup` adds `ssr`, `hydrate`, `prerender` to the exports Fast Refresh ignores, for `+droplet` and `+error` files, behind `import.meta.env.DEV`. `src/client-setup.ts:29`, `src/client-setup.ts:45`
- `client-setup` chains a previous `__getReactRefreshIgnoredExports` and installs once (`__dropletsReactRefresh`). `src/client-setup.ts:35`
- `./form` exports `useEnhanceDropletForm(formRef, options?)`: it enhances the form in an effect keyed on the ref and reads its options at each submit. `src/form.ts:42`
- `./form` without `onResult` calls `result.update()`. `src/form.ts:55`
- Package exports are `.`, `./server`, `./client`, `./form`, `./package.json`; core imports `client-dev` and `client-setup` by file path. `package.json:23`
- Dependency is `@vitejs/plugin-react` `^6.0.0`; peers are `@dropletsjs/droplets`, `react` `^19.0.0`, `react-dom` `^19.0.0`, `vite` `^8.0.0`. `package.json:58`, `package.json:61`
- Node engine is `>=22`. `package.json:47`
- Build script runs tsdown, then the tests. `package.json:50`
- tsdown entries are `index`, `server`, `client`, `client-dev`, `client-setup`, `form`. `tsdown.config.ts:6`
- graphCheck client entries are `client`, `client-dev`, `client-setup`, `form`; server modules `index`, `server`, `refresh`. `tsdown.config.ts:9`
- Suite runs on `rendererTests` from `@dropletsjs/shared/vitest` (happy-dom). `vitest.config.ts:1`

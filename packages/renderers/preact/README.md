# @dropletsjs/renderer-preact

The Preact 11 renderer for [Droplets](https://dropletsjs.dev): `+droplet.tsx`
and `+error.tsx` (or `.jsx`), rendered with `preact-render-to-string` and
hydrated or mounted in the browser. It compiles its own JSX and runs
Prefresh under `vite dev`, with no `@preact/preset-vite`.

The docs page, with a live droplet: [Preact](https://dropletsjs.dev/renderers/preact/).

```bash
pnpm add @dropletsjs/renderer-preact preact preact-render-to-string
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { node } from "@dropletsjs/adapter-node";
import { preact } from "@dropletsjs/renderer-preact";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [preact()] })],
});
```

```tsx
// src/droplets/hello/+droplet.tsx
import { useState } from "preact/hooks";
import type { DropletProps } from "./$types"; // data: what +droplet.server.ts's load returns

export const hydrate = true; // flags: ssr, hydrate, prerender

export default function Hello({ data, children }: DropletProps) {
  const [clicks, setClicks] = useState(0);
  // Always the value: when the element mounts a droplet fresh, the renderer
  // awaits its data first.
  return (
    <>
      <h1>{data.greeting}</h1>
      <button onClick={() => setClicks((n) => n + 1)}>{clicks}</button>
      {children}
    </>
  );
}
```

```tsx
// src/droplets/hello/+error.tsx
import type { DropletErrorProps } from "@dropletsjs/renderer-preact";

export default function HelloError({ error, children }: DropletErrorProps<{ message: string }>) {
  return (
    <>
      <p class="oops">{error.message}</p>
      {children}
    </>
  );
}
```

## Details

### Options

```ts
preact({
  plugin: true, // false: compile the components yourself (jsxImportSource "preact")
});
```

### Components

- **Flags** are literal named exports; the component is the default export.
- **Children:** `children` renders the host's content.
- **Data is always the value.** Preact has no `use(promise)`, so the renderer
  awaits a promise of `data` (a client-only or refreshed droplet) before it
  renders. A rejection shows `+error.tsx`; a render error later on reaches
  the renderer's error boundary, which shows it too.
- **Hydration** adopts the server's nodes (Preact's `hydrate`); both it and
  `render` are synchronous, so the droplet is live when the call returns.
- **Styles:** imported CSS reaches the droplet's stylesheet. Attributes are
  HTML's: `class`, `for`.
- **Forms:** `actionUrl(name?)` from `$droplets/form` gives where a form posts
  for an action in `+droplet.server.ts`: keep it from the first render,
  `const [add] = useState(() => actionUrl("add"))`, then
  `<form method="post" action={add}>`. Such a form posts as any form does.
  `useEnhanceDropletForm(formRef, options?)` from
  `@dropletsjs/renderer-preact/form` opts it in to progressive enhancement.
  See [Actions](https://dropletsjs.dev/guides/actions/).

### JSX and hot updates

The renderer compiles its modules with Preact's automatic runtime
(`preact/jsx-runtime`) itself; nothing aliases `react` to `preact/compat`.
Under `vite dev` (`dev.strategy: "hmr"`, the default), Prefresh keeps the
component's hook state through an edit. It is compiled into Preact's modules
only, in the renderer's own transform, never through Vite's shared `oxc`
options.

### Several JSX frameworks

`.tsx` and `.jsx` are the suffixes React, Solid and Hono JSX claim too. All
of them can share a project: a droplet's framework is the one its file
imports (`preact`, `preact/hooks`, …), or a `/** @jsxImportSource preact */`
comment, and each renderer compiles only the modules its own droplets
reach. See
[Several frameworks in one project](https://dropletsjs.dev/renderers/#several-frameworks-in-one-project).

### Changing this package

`pnpm --filter @dropletsjs/renderer-preact build` runs tsdown, then the
tests, which import `dist/`. `src/plugin.ts` is server code (it runs in
Vite).

## Facts

- `preact()` name is `"preact"`. `src/index.ts:72`
- `preact()` extensions are `[".tsx", ".jsx"]`. `src/index.ts:73`
- `preact()` packages are `preact`, `preact-render-to-string` and `@dropletsjs/renderer-preact`: another renderer's droplet that imports one fails the build. `src/index.ts:74`, `../../droplets/src/vite/renderer-graphs.ts:62`
- `preact()` sets no `suffixes` and no `clientSetup`. `src/index.ts:71`
- `preact()` componentTypes is `@dropletsjs/renderer-preact`: `./$types` takes `DropletProps` and `DropletErrorProps` from it. `src/index.ts:75`, `../../droplets/src/vite/sync-types.ts:37`
- `preact()` server, client and clientDev are `dist/server.js`, `dist/client.js`, `dist/client-dev.js` under the package root. `src/index.ts:78`
- `preact()` has no `readFlags`: core reads the named exports with `readExportedFlags`. `../../droplets/src/core/discover.ts:146`, `test/index.test.ts:31`
- `preact()` plugins are a function of core's scope: one `droplets:preact` with `scope.include`; `plugin: false` leaves `plugins` unset. `src/index.ts:77`
- `DropletProps` has `data` (always the value), `form?` and `children?`. `src/index.ts:48`
- `DropletErrorProps` has `error` and `children?`. `src/index.ts:56`
- `droplets:preact` runs `enforce: "pre"`, in every environment and in builds. `src/plugin.ts:88`
- `droplets:preact` compiles `.tsx` / `.jsx` outside `node_modules` with oxc, `jsx: { runtime: "automatic", importSource: "preact" }`. `src/plugin.ts:77`, `src/plugin.ts:101`
- `droplets:preact` with `include` compiles only the ids it matches (core's `?droplets-renderer=preact` mark). `src/plugin.ts:102`
- `droplets:preact` turns on Prefresh under `vite dev` only, outside production and with HMR on. `src/plugin.ts:96`
- `droplets:preact` compiles with oxc's refresh transform only for the client environment. `src/plugin.ts:103`
- `droplets:preact` adds `@prefresh/core` and `@prefresh/utils` to `optimizeDeps.include` under `serve`, so Prefresh patches the page's one copy of Preact. `src/plugin.ts:93`
- `droplets:preact` resolves `@prefresh/core` and `@prefresh/utils` per module, since the pre-bundled URL changes when Vite optimizes again. `src/plugin.ts:110`
- `droplets:preact` warns and turns Prefresh off when the Prefresh runtime does not resolve: Preact droplets then remount on an edit. `src/plugin.ts:112`
- `droplets:preact` adds the Prefresh prelude to a module with `$RefreshReg$` or `$RefreshSig$` calls, and the accepting footer only with `$RefreshReg$`. `src/plugin.ts:106`, `src/plugin.ts:119`
- Prefresh footer logs `[droplets] Prefresh could not apply the update` when its flush throws. `src/plugin.ts:67`
- Prefresh prelude is one line, so the source map stays in step. `src/plugin.ts:43`
- Server `render` returns `renderToString` of the component with the props and the children vnode; never a `head`. `src/server.ts:29`
- Server `render` throws `<droplet>: the <kind> component is not a Preact component` for a default export that is not a function. `src/server.ts:22`
- Server module imports no Node modules: it runs on Node, Bun, Deno and Workers. `src/server.ts:4`
- Children marker is `<div data-droplet-children style="display: contents">`, rendered by `DropletChildren`. `src/children.ts:35`
- Children host reaches `DropletChildren` through `ChildrenHostContext`, `null` on the server. `src/children.ts:21`, `src/tree.ts:65`
- `DropletChildren` calls `host.fill(marker)` in a layout effect and `host.empty(marker)` in its cleanup; it depends on the host alone. `src/children.ts:29`
- Client `mount` renders with Preact's `render` and `hydrate` with Preact's `hydrate`; both are synchronous. `src/client.ts:59`, `src/client.ts:80`
- Client `mount` with a promise of `data` awaits it, then renders inside `context.rendering`, so `actionUrl()` still knows the droplet. `src/client.ts:62`, `src/client.ts:66`
- Client `mount` with a rejected `data` renders the error page with what `handle` returned, nothing when it rejects, and rethrows without an error page. `src/client.ts:38`, `src/client.ts:43`, `src/client.ts:46`
- Client instance is `{ target, component, context }`, only `{ target }` when the error page or nothing shows. `src/client.ts:24`, `src/client.ts:69`
- Client `unmount` calls `render(null, target)`. `src/client.ts:85`
- Client tree with an error page wraps the component in `DropletBoundary`, which passes the error through `handle`, then renders the error page with the result and `children`; nothing while it runs or when it rejects. `src/tree.ts:61`, `src/tree.ts:43`
- Client dev `update` awaits a promise of `data`, renders the same tree with new props into the target, and returns `true`. `src/client-dev.ts:15`
- Client dev `update` returns `false` for an instance without a component, and core remounts. `src/client-dev.ts:14`
- `./form` exports `useEnhanceDropletForm(formRef, options?)`: it enhances the form in an effect keyed on the ref and reads its options at each submit. `src/form.ts:43`
- `./form` without `onResult` calls `result.update()`. `src/form.ts:56`
- Package exports are `.`, `./server`, `./client`, `./form`, `./package.json`; core imports `client-dev` by file path. `package.json:23`
- Dependencies are `@prefresh/core` `^1.5.11` and `@prefresh/utils` `^1.2.1`; peers are `@dropletsjs/droplets`, `preact` `^11.0.0`, `preact-render-to-string` `^6.8.0`, `vite` `^8.0.0`. `package.json:58`, `package.json:62`
- Node engine is `>=22`. `package.json:47`
- Build script runs tsdown, then the tests. `package.json:50`
- tsdown entries are `index`, `server`, `client`, `client-dev`, `form`. `tsdown.config.ts:6`
- graphCheck client entries are `client`, `client-dev`, `form`; server modules `index`, `server`, `plugin`. `tsdown.config.ts:9`
- Suite runs on `rendererTests` from `@dropletsjs/shared/vitest` (happy-dom). `vitest.config.ts:1`

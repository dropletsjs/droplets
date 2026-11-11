# @dropletsjs/renderer-react

The React 19 renderer for [Droplets](https://dropletsjs.dev): `+droplet.tsx`
and `+error.tsx` (or `.jsx`), rendered with `renderToString` and hydrated or
mounted in the browser.

The docs page, with a live droplet: [React](https://dropletsjs.dev/renderers/react/).

```bash
pnpm add @dropletsjs/renderer-react@alpha react react-dom
```

```ts
// vite.config.ts
import { droplets } from "@dropletsjs/droplets/vite";
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

- **Flags** are literal named exports; the component is the default export.
- **Children:** `children` renders the host's content.
- **Data as a promise:** `use(data)` suspends; a rejection reaches the
  renderer's error boundary.
- **Styles:** imported CSS reaches the droplet's stylesheet.
- **Forms:** `actionUrl(name?)` from `$droplets/form` gives where a form posts
  for an action in `+droplet.server.ts`, the same URL on the server and in
  the browser: keep it from the first render,
  `const [add] = useState(() => actionUrl("add"))`, then
  `<form method="post" action={add}>`. Such a form posts as any form does.
  `useEnhanceDropletForm(formRef, options?)` from
  `@dropletsjs/renderer-react/form` opts it in to progressive
  enhancement: the submit goes by `fetch` and the droplet shows the result
  in place. See [Actions](https://dropletsjs.dev/guides/actions/).
- **Fast Refresh** works on any host page under `vite dev`
  (`dev.strategy: "hmr"`, the default), keeping component state; the
  renderer installs the preamble itself, and compiles it into React's
  modules alone, never into another framework's (a Vue `<script lang="ts">`).
- On Workers, the server uses React's edge build.
- Solid, React, Preact and Hono JSX all claim `.tsx` and `.jsx` and can share
  a project: a droplet's framework is the one its file imports (`react`,
  `preact`, `solid-js` or `hono/jsx`), or a `/** @jsxImportSource … */` comment. See
  [Several frameworks in one project](https://dropletsjs.dev/renderers/#several-frameworks-in-one-project).

## Options

```ts
react({
  plugin: true,     // false: register @vitejs/plugin-react yourself
  vitePlugin: {},   // options for @vitejs/plugin-react
});
```

MIT

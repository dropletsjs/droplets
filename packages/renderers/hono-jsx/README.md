# @dropletsjs/renderer-hono-jsx

The Hono JSX renderer for [Droplets](https://dropletsjs.dev): `+droplet.tsx`
and `+error.tsx` (or `.jsx`) written with `hono/jsx`, the JSX Hono ships.
Rendered to a string on the server and with `hono/jsx/dom` in the browser.
No framework package beyond `hono`.

The docs page, with a live droplet: [Hono JSX](https://dropletsjs.dev/renderers/hono-jsx/).

```bash
pnpm add @dropletsjs/renderer-hono-jsx@alpha hono
```

```ts
// vite.config.ts
import { droplets } from "@dropletsjs/droplets/vite";
import { honoJsx } from "@dropletsjs/renderer-hono-jsx";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [honoJsx()] })],
});
```

```tsx
// src/droplets/hello/+droplet.tsx
import { use, useState } from "hono/jsx";
import type { DropletProps } from "@dropletsjs/renderer-hono-jsx";

export const hydrate = true; // flags: ssr, hydrate, prerender

export default function Hello({ data, children }: DropletProps<{ greeting: string }>) {
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
  loaded (a typed value, focus) does not survive.
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
  in place. See [Actions](https://dropletsjs.dev/guides/writing-droplets/#actions).
- **No HMR of its own:** under `vite dev` an edit remounts the droplet in
  place, without a page reload (`dev.strategy: "hmr"`, the default).
- React, Preact and Solid claim `.tsx` and `.jsx` too, and all four can share
  a project: a droplet's framework is the one its file imports (`hono/jsx`,
  `react`, `preact`, `solid-js`), or a `/** @jsxImportSource hono/jsx */` comment.
  Importing `hono` itself (a client, `hono/cookie`) says nothing. See
  [Several frameworks in one project](https://dropletsjs.dev/renderers/#several-frameworks-in-one-project).

## Options

```ts
honoJsx({
  plugin: true, // false: compile the components yourself
});
```

MIT

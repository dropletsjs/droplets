# @dropletsjs/renderer-solid

The Solid renderer for [Droplets](https://dropletsjs.dev): `+droplet.tsx` and
`+error.tsx` (or `.jsx`), rendered on the server and hydrated or mounted in
the browser.

The docs page, with a live droplet: [Solid](https://dropletsjs.dev/renderers/solid/).

```bash
pnpm add @dropletsjs/renderer-solid@alpha solid-js
```

```ts
// vite.config.ts
import { droplets } from "@dropletsjs/droplets/vite";
import { solid } from "@dropletsjs/renderer-solid";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [solid()] })],
});
```

```tsx
// src/droplets/hello/+droplet.tsx
import { createResource, createSignal } from "solid-js";
import type { DropletProps } from "@dropletsjs/renderer-solid";

export const hydrate = true; // flags: ssr, hydrate, prerender

export default function Hello(props: DropletProps<{ greeting: string }>) {
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

- **Flags** are literal named exports; the component is the default export.
- **Children:** `props.children` renders the host's content.
- **Data as a promise:** a resource of it suspends; one that rejects reaches
  the renderer's error boundary.
- **Forms:** `actionUrl(name?)` from `$droplets/form` gives where a form posts
  for an action in `+droplet.server.ts`, the same URL on the server and in
  the browser: `const add = actionUrl("add")` in the component, then
  `<form method="post" action={add}>`. Such a form posts as any form does.
  The directive `use:enhanceDropletForm` from
  `@dropletsjs/renderer-solid/form` opts it in to progressive
  enhancement: the submit goes by `fetch` and the droplet shows the result
  in place. See [Actions](https://dropletsjs.dev/guides/writing-droplets/#actions).
- **Hydration** is keyed by the droplet's render id, so several Solid droplets
  on a page hydrate independently. The renderer sets up Solid's hydration
  state itself; hosts need no script.
- Solid, React, Preact and Hono JSX all claim `.tsx` and `.jsx` and can share
  a project: a droplet's framework is the one its file imports (`react`,
  `preact`, `solid-js` or `hono/jsx`), or a `/** @jsxImportSource … */` comment. See
  [Several frameworks in one project](https://dropletsjs.dev/renderers/#several-frameworks-in-one-project).

## Options

```ts
solid({
  plugin: true,     // false: register vite-plugin-solid yourself (with ssr: true)
  vitePlugin: {},   // options for vite-plugin-solid; ssr is always true
});
```

MIT

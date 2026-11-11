# @dropletsjs/renderer-preact

The Preact 11 renderer for [Droplets](https://dropletsjs.dev): `+droplet.tsx`
and `+error.tsx` (or `.jsx`), rendered with `preact-render-to-string` and
hydrated or mounted in the browser.

The docs page, with a live droplet: [Preact](https://dropletsjs.dev/renderers/preact/).

```bash
pnpm add @dropletsjs/renderer-preact@alpha preact preact-render-to-string
```

```ts
// vite.config.ts
import { droplets } from "@dropletsjs/droplets/vite";
import { preact } from "@dropletsjs/renderer-preact";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [preact()] })],
});
```

```tsx
// src/droplets/hello/+droplet.tsx
import { useState } from "preact/hooks";
import type { DropletProps } from "@dropletsjs/renderer-preact";

export const hydrate = true; // flags: ssr, hydrate, prerender

export default function Hello({ data, children }: DropletProps<{ greeting: string }>) {
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
  See [Actions](https://dropletsjs.dev/guides/writing-droplets/#actions).
- **JSX:** the renderer compiles its modules with Preact's automatic runtime
  (`preact/jsx-runtime`) itself; there is no `@preact/preset-vite`, and
  nothing aliases `react` to `preact/compat`.
- **Hot updates:** Prefresh under `vite dev` (`dev.strategy: "hmr"`, the
  default): an edit keeps the component's hook state. It is compiled into
  Preact's modules only, in the renderer's own transform.
- **Files:** `.tsx` and `.jsx`, the suffixes React, Solid and Hono JSX claim
  too. All of them can share a project: a droplet's framework is the one its
  file imports (`preact`, `preact/hooks`, …), or a
  `/** @jsxImportSource preact */` comment, and each renderer compiles only
  the modules its own droplets reach. See
  [Several frameworks in one project](https://dropletsjs.dev/renderers/#several-frameworks-in-one-project).

## Options

```ts
preact({
  plugin: true, // false: compile the components yourself (jsxImportSource "preact")
});
```

MIT

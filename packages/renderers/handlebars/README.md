# @dropletsjs/renderer-handlebars

The Handlebars renderer for [Droplets](https://dropletsjs.dev): `+droplet.hbs`
and `+error.hbs`, precompiled at build. Only `handlebars/runtime` ships, on the
server and in the browser.

The docs page, with a live droplet: [Handlebars](https://dropletsjs.dev/renderers/handlebars/).

```bash
pnpm add @dropletsjs/renderer-handlebars@alpha
```

```ts
// vite.config.ts
import { droplets } from "@dropletsjs/droplets/vite";
import { handlebars } from "@dropletsjs/renderer-handlebars";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [handlebars()] })],
});
```

```hbs
{{!--
export ssr = true
export hydrate = false
--}}
<h1>{{data.greeting}}</h1>
<p>{{upper data.who}}</p>
{{> footer}}
{{{children}}}

<style>
  h1 { font-family: system-ui, sans-serif; }
</style>
<style src="./theme.css"></style>
```

```hbs
{{!-- src/droplets/hello/+error.hbs --}}
<p>{{error.message}}</p>
{{{children}}}
```

```ts
// src/handlebars.ts: every exported function is a helper
export const upper = (value: unknown) => String(value).toUpperCase();
```

- **Flags** go in the comment the template opens with, before anything else:
  `export <flag> = <value>`, on lines of their own or on one line. Or in
  `+droplet.ts` (`export const hydrate = false`), never the same flag in both.
  A misplaced or misspelled flag fails the build.
- **Context:** `{{data.…}}` in the droplet, `{{error.…}}` in the error page,
  `{{{children}}}` for the host's content. `@droplet`, `@kind` and
  `@renderId` are data variables of the render.
- **Forms:** `{{action "add"}}` outputs where a form posts for an action in
  `+droplet.server.ts` (`{{action}}` for `default`):
  `<form method="post" action="{{action "add"}}">`. `action` and `children`
  are the renderer's helpers; a project helper by those names is ignored.
  Such a form posts as any form does; `data-droplets-enhance` on it opts in
  to progressive enhancement, which `/index.js` applies: the submit goes by
  `fetch` and the droplet shows the result in place (a `hydrate = false`
  droplet gets its fragment rendered again by the server). See
  [Actions](https://dropletsjs.dev/guides/actions/).
- **Partials** come from `src/partials/**/*.hbs`, registered by path without
  the extension. **Helpers** come from the exports of `src/handlebars.ts`. Both
  go into the renderer's own Handlebars environment, never the global one.
- **Styles:** `<style>` blocks, inline or with `src`, at the top of the
  template (outside `{{#…}}` blocks, no `{{…}}` inside). They are taken out at
  build and become the droplet's stylesheet, scoped to the element. Partials
  have none.
- **In the browser** a template has no behaviour of its own: `hydrate` keeps
  the server HTML and wires the host's children; `mount` renders the template
  (client-only droplets, error pages). A load returning a promise is awaited.

## Options

```ts
handlebars({
  partials: "src/partials",   // false: none
  helpers: "src/handlebars.ts", // default when it exists; false: none
  compile: {},                // options for Handlebars.precompile: strict, noEscape, …
});
```

MIT

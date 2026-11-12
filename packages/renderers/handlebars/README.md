# @dropletsjs/renderer-handlebars

The Handlebars renderer for [Droplets](https://dropletsjs.dev): `+droplet.hbs`
and `+error.hbs`, precompiled at build. Only `handlebars/runtime` ships, on the
server and in the browser; a template has no browser behaviour of its own.

The docs page, with a live droplet: [Handlebars](https://dropletsjs.dev/renderers/handlebars/).

```bash
pnpm add @dropletsjs/renderer-handlebars
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { node } from "@dropletsjs/adapter-node";
import { handlebars } from "@dropletsjs/renderer-handlebars";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [handlebars()] })],
});
```

## Details

### Templates

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
  `export <flag> = <value>`, on lines of their own or on one line, and
  nowhere else. The syntax is strict on purpose: a misplaced, misspelled,
  repeated or non-literal flag in the template fails the build and
  `vite dev`, so a typo never passes silently. One exported from
  `+droplet.ts` or `+droplet.server.ts` is ignored; `+error.hbs` follows
  the droplet's flags.
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

### Options

```ts
handlebars({
  partials: "src/partials",   // false: none
  helpers: "src/handlebars.ts", // default when it exists; false: none
  compile: {},                // options for Handlebars.precompile: strict, noEscape, …
});
```

### How it renders

- The plugin (`src/plugin.ts`) precompiles every `.hbs` into a module whose
  default export is the template, built on one `Handlebars.create()`
  environment (`src/runtime.ts`). A droplet template also imports
  `virtual:droplets-handlebars/setup`, which registers the partials and
  helpers once per bundle.
- Server (`src/server.ts`): the template called with the props as its
  context and the render's ids as data variables.
- Browser (`src/client.ts`): `hydrate` keeps the server HTML and fills the
  children markers; `mount` awaits `data` and writes the template's HTML,
  or the error page when `data` rejects.
- Under `vite dev`, `src/client-dev.ts` writes the template again with new
  data, and compiled templates accept their own HMR update.

### Changing this package

`pnpm --filter @dropletsjs/renderer-handlebars build` runs tsdown, then the
tests under happy-dom (`test/index.test.ts`, `plugin.test.ts`,
`runtime.test.ts` and `server.test.ts` under Node): the conformance kit and
the index test use `dist/`. `src/runtime.ts` is a tsdown entry: compiled
templates import `dist/runtime.js` by path.

## Facts

- `handlebars()` returns the renderer named `handlebars`, claiming `.hbs` only. `src/index.ts:164`, `src/index.ts:165`
- `handlebars()` packages are `handlebars` and `@dropletsjs/renderer-handlebars`. `src/index.ts:166`
- `handlebars()` sets no `componentTypes` and no `clientSetup`. `src/index.ts:163`
- `handlebars()` server, client and clientDev are `dist/server.js`, `dist/client.js` and `dist/client-dev.js`, found by path. `src/index.ts:168`, `src/index.ts:170`
- `handlebars()` readFlags reads the template's leading comment, naming errors `<droplet>/<file>`. `src/index.ts:171`, `src/index.ts:158`
- Flags comment is the comment the template opens with, whitespace aside. `src/index.ts:87`
- Flags comment declarations are split by line, by `;` or before the next `export`. `src/index.ts:121`
- Flags comment without any `export` line is an ordinary comment: no flags declared, core's defaults apply. `src/index.ts:124`
- Flags comment with an `export` line takes nothing else: any other line fails the build. `src/index.ts:130`
- Flags comment typo: an unknown flag name fails the build with `unknown flag "<name>"`. `src/index.ts:133`
- Flags comment: a flag declared twice fails the build. `src/index.ts:135`
- Flags `ssr` and `prerender` take `true` or `false` only; anything else fails the build. `src/index.ts:144`
- Flags `hydrate` takes `true`, `false`, `"visible"` or `"interactive"` (through `parseHydrateMode`); anything else fails the build. `src/index.ts:137`, `src/index.ts:139`
- Flags in any comment but the leading one (a known flag name after `export`) fail the build. `src/index.ts:113`
- Flags: a template Handlebars cannot parse declares none; the compiler reports it. `src/index.ts:108`
- Flags exported from `+droplet.ts` or `+droplet.server.ts` are ignored, in a build and in `vite dev`. `test/index.test.ts:188`
- Flags `+error.hbs` declares are ignored, with a warning under `vite dev` only: it follows the droplet's flags. `../../droplets/src/core/discover.ts:183`
- `readTemplateFlags(source, where)` and `readFlags` live in `src/flags.ts`; the package entry exports `handlebars()` and its types alone, and `readFlags` reaches core on the renderer object. `src/flags.ts:43`, `src/flags.ts:98`, `src/index.ts:73`
- Plugin is named `droplets:handlebars` and runs with `enforce: "pre"`. `src/plugin.ts:178`, `src/plugin.ts:181`
- Plugin bundles `handlebars` and `handlebars/*` into the `ssr` and `server` builds (`noExternal`). `src/plugin.ts:189`, `src/plugin.ts:192`
- Partials folder defaults to `src/partials`; `partials: false` registers none. `src/plugin.ts:201`
- Helpers module defaults to `src/handlebars.ts`, then `src/handlebars.js`, when it exists; `helpers: false` registers none. `src/plugin.ts:168`, `src/plugin.ts:204`
- Partials are every `.hbs` under the folder, sorted, named by path without `.hbs` (`layout/header`). `src/plugin.ts:83`, `src/plugin.ts:74`
- Partials are compiled without the setup import; droplet templates import `virtual:droplets-handlebars/setup` first. `src/plugin.ts:236`, `src/plugin.ts:138`
- Partials with a `<style>` block fail the build. `src/plugin.ts:233`
- Setup module registers each partial and calls `registerHelpers` on the renderer's environment, once per bundle. `src/plugin.ts:161`, `src/plugin.ts:163`
- Setup module is invalidated when a partial or the helpers module is added or removed. `src/plugin.ts:243`, `src/plugin.ts:248`
- Compiled template module: `export default env.template(<spec>)`, importing `env` from `dist/runtime.js`. `src/plugin.ts:141`, `src/plugin.ts:57`
- Compiled template module accepts no HMR update of its own, so an edit propagates to the droplet's client module: a hydrated droplet remounts in place (`droplets:hot-fallback`), one that is not gets its fragment again. `src/plugin.ts:126`, `../../../tests/dev-mixed/test/dev.test.ts:328`, `../../../tests/dev-mixed/test/dev.test.ts:349`
- `compile` options go to `Handlebars.precompile`, with `srcName` always unset. `src/plugin.ts:135`
- Environment is one `Handlebars.create()` of `handlebars/runtime`, never the global `Handlebars`. `src/runtime.ts:21`
- `{{{children}}}` helper outputs `<div data-droplet-children style="display: contents"></div>`. `src/runtime.ts:24`, `src/runtime.ts:28`
- `{{action}}` helper outputs the render's `actionUrl(name)`, escaped; a non-string name throws. `src/runtime.ts:36`, `src/runtime.ts:39`
- `{{action}}` outside a renderer's render (no `actionUrl` in the data frame) throws. `src/runtime.ts:41`
- `registerHelpers` registers each exported function, plus the entries of a `default` object; named exports win. `src/runtime.ts:73`
- `registerHelpers` never registers `children` or `action` from a project. `src/runtime.ts:46`, `src/runtime.ts:75`
- Template missing from a module throws `<droplet>: +<kind>.hbs did not compile to a template function`. `src/runtime.ts:54`
- Server render calls the template with the props as context and `droplet`, `kind`, `renderId`, `actionUrl` as data variables. `src/server.ts:14`, `src/server.ts:15`
- Client hydrate keeps the server HTML and fills `context.markers()`, or the template's own markers when there are none. `src/client.ts:80`, `src/client.ts:81`
- Client mount awaits `data`, then writes the template into `innerHTML` and fills the markers. `src/client.ts:66`, `src/client.ts:69`
- Client mount with rejected `data` renders the error page from `handle` (the droplet's `handleError`), nothing when `handle` rejects, and rethrows without an error page. `src/client.ts:53`, `src/client.ts:55`, `src/client.ts:51`
- Client markers skip those of a droplet nested in the template's markup. `src/client.ts:27`
- Client unmount empties every marker while it is still in the document, then clears the target. `src/client.ts:88`, `src/client.ts:89`
- `update` (clientDev) renders a droplet template again with the new data; an error page or props without `data` answer false. `src/client-dev.ts:13`, `src/client-dev.ts:17`
- Styles: `<style>` blocks are taken out of the template, each replaced by as many line breaks as it spanned. `src/styles.ts:133`, `src/styles.ts:135`
- Styles: an inline block becomes `<template>?droplets-style=<n>&lang.<lang>` (`lang` default `css`), a `src` block an import of that file. `src/styles.ts:38`, `src/styles.ts:122`, `src/plugin.ts:103`
- Styles: a block inside `{{#…}}` or containing `{{…}}` fails the build. `src/styles.ts:100`, `src/styles.ts:128`
- Styles: a `src` block with CSS inside fails the build. `src/styles.ts:119`
- Styles in a commented-out block are left as they are. `test/styles.test.ts:21`
- Forms enhancement is the `data-droplets-enhance` attribute, which `/index.js` applies; the package has no `./form` export. `test/conformance.test.ts:17`, `package.json:23`
- Package exports are `.`, `./server` and `./client`. `package.json:23`
- `handlebars ^4.7.10` is a dependency; peers are `@dropletsjs/droplets` and `vite ^8.0.0`. `package.json:54`, `package.json:57`
- Node engine is `>=22`. `package.json:43`
- Build script runs tsdown, then the tests. `package.json:46`
- graphCheck: client entries `client`, `client-dev`, `runtime`; server `index`, `server`, `plugin`, `styles`. `tsdown.config.ts:9`, `tsdown.config.ts:10`
- Conformance runs with `interactive: false` (no browser behaviour) and `enhance: "attribute"`. `test/conformance.test.ts:15`, `test/conformance.test.ts:17`

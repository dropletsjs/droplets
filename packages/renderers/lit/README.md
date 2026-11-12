# @dropletsjs/renderer-lit

The Lit renderer for [Droplets](https://dropletsjs.dev): `+droplet.lit.ts`
and `+error.lit.ts` (or `.lit.js`), each a `LitElement` class. Rendered on
the server into a declarative shadow root with `@lit-labs/ssr`, hydrated in
place in the browser with `@lit-labs/ssr-client`.

The docs page, with a live droplet: [Lit](https://dropletsjs.dev/renderers/lit/).

> **Lit SSR is a Lit Labs package**: experimental upstream, with breaking
> changes possible in minor versions. This renderer is tested with Lit 3.3,
> `@lit-labs/ssr` 4.1 and `@lit-labs/ssr-client` 1.1. Lit SSR renders shadow
> DOM components only, and synchronously.

```bash
pnpm add @dropletsjs/renderer-lit@alpha lit
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { node } from "@dropletsjs/adapter-node";
import { lit } from "@dropletsjs/renderer-lit";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [lit()] })],
});
```

## Details

### Components

```ts
// src/droplets/hello/+droplet.lit.ts
import { css, html } from "lit";
import { DropletElement } from "@dropletsjs/renderer-lit/element";
import type { DropletProps } from "./$types";

export const hydrate = true; // flags: ssr, hydrate, prerender

export default class Hello extends DropletElement<DropletProps> {
  static override properties = { clicks: { state: true } };
  static override styles = css`h1 { font-family: system-ui, sans-serif; }`;
  declare clicks: number;

  constructor() {
    super();
    this.clicks = 0; // not a class field: a field would hide Lit's property
  }

  override render() {
    return html`
      <h1>${this.data.greeting}</h1>
      <button @click=${() => (this.clicks += 1)}>${this.clicks}</button>
      <slot></slot>
    `;
  }
}
```

```ts
// src/droplets/hello/+error.lit.ts
import { html } from "lit";
import { DropletErrorElement } from "@dropletsjs/renderer-lit/element";
import type { DropletErrorProps } from "./$types";

export default class HelloError extends DropletErrorElement<DropletErrorProps> {
  override render() {
    return html`<p>${this.error.message}</p><slot></slot>`;
  }
}
```

- **Flags** are literal named exports; the class is the default export.
- **The tag** is `<element>-<droplet id>` (`…--error` for the error page),
  `<element>` being the droplets server's element name, so two droplets
  servers on one page never compete for a name. The renderer defines the
  class: never call `customElements.define` in a droplet file.
  `lit({ prefix })` sets another prefix.
- **Properties**, never attributes: `data` (always a value: the renderer
  waits for it), `form` after an action, `error` on the error page, and
  `actionUrl(name?)`, where a form posts. `DropletElement` and
  `DropletErrorElement` declare them; a plain `LitElement` declares them with
  `attribute: false`. Declare, never initialise them as class fields.
- **Children:** the host's children are the element's light-DOM child; a
  `<slot>` shows them.
- **Styles** live in the shadow root: `static styles`. The droplet's
  `style.css`, the shared stylesheet and the host's CSS reach the light DOM
  only; inherited properties and CSS custom properties flow in.
- **`innerHTML`:** a fragment inserted with `innerHTML` keeps its
  `<template shadowrootmode>` inert. `hydrate` attaches it first, then
  adopts the nodes without rendering them again.
- **Forms:** `<form method="post" action=${this.actionUrl()}>` posts
  natively. `enhance()` of `@dropletsjs/renderer-lit/form` posts it by fetch
  and updates the droplet in place:
  `<form method="post" action=${this.actionUrl()} ${enhance<DropletActions>()}>`.
  The `data-droplets-enhance` attribute cannot reach a form in a shadow
  root: the submit event does not leave it.
- **`hydrate = "interactive"`** works from inside the shadow root: the
  events that start it are composed, and the replayed click reaches the
  element clicked.
- **Cloudflare Workers:** the renderer bundles Lit's server build (`node/`)
  into the server, which runs on Lit's DOM shim and needs no DOM and no Node
  API. Node, Bun, Deno and Workers render alike.
- **Under `vite dev`** new props render into the same element, its state
  kept; an edit remounts the droplet in place, without a page reload, its
  class defined anew as `<tag>--v2`.

See [Renderers](https://dropletsjs.dev/renderers/lit/).

### Options

```ts
lit({
  prefix: "my-shop", // lowercase letters, digits, hyphens; default: the droplets element name
});
```

### How it renders

- Server (`src/render.ts`): `render` of `@lit-labs/ssr` prints the host
  template (`src/template.ts`), the element with `defer-hydration`, its
  shadow root as `<template shadowrootmode="open">` and the children marker
  in light DOM.
- Browser hydrate (`src/client.ts`): attach the inert declarative shadow
  roots (`attachShadowRoots`, innermost first),
  define the class under the tag the server used, `hydrate` of
  `@lit-labs/ssr-client`, then remove `defer-hydration`. When another class
  holds the tag, it warns and mounts afresh.
- Browser mount: awaits `data`, renders the host template, or the error page
  when `data` rejects.
- `src/client-setup.ts` imports `lit-element-hydrate-support` before any
  `lit-element` is evaluated.

### Changing this package

`pnpm --filter @dropletsjs/renderer-lit build` runs tsdown, then the tests,
under Node with no DOM globals, as on a server. `test/integration/workers.test.ts`
builds the fixture with `@dropletsjs/adapter-cloudflare` and runs
`worker.js` in process, so that adapter must be built.
`test/conformance.test.ts` runs `rendererConformance()` on
`test/fixtures/conformance` under happy-dom (its pragma), with `css: false`:
a component's styles live in its shadow root, so the client build extracts
none. The kit's server renders in a worker thread, where Lit's DOM shim
finds no happy-dom. What only a real browser shows (the parser attaching
declarative shadow roots, styles inside the shadow root, the replayed click
inside it) is checked in Chromium by `tests/examples/e2e/lit.spec.ts`.

## Facts

- `lit()` returns the renderer named `lit`, claiming `.lit.ts` and `.lit.js`. `src/index.ts:87`, `src/index.ts:88`
- `lit()` packages are `lit`, `lit-html`, `lit-element`, `@lit/reactive-element`, `@lit-labs/ssr-client` and `@dropletsjs/renderer-lit`. `src/index.ts:89`
- `lit()` componentTypes is `@dropletsjs/renderer-lit`: `./$types` takes `DropletProps` and `DropletErrorProps` from this package. `src/index.ts:90`, `../../droplets/src/vite/sync-types.ts:37`
- `lit()` server, client, clientDev and clientSetup are `dist/server.js`, `dist/client.js`, `dist/client-dev.js` and `dist/client-setup.js`, found by path. `src/index.ts:92`, `src/index.ts:96`
- `lit()` has no `readFlags`: core's default reader takes flags from the component's literal named exports. `../../droplets/src/core/discover.ts:146`
- `lit({ prefix })` must match `^[a-z][a-z0-9-]*$` (a lowercase letter, then lowercase letters, digits and hyphens), or `lit()` throws naming that. `src/index.ts:83`, `src/index.ts:84`, `test/index.test.ts:31`
- `DropletProps` data is always a value (`Data`), never a promise: the renderer awaits it. `src/index.ts:60`, `src/client.ts:79`
- Prefix defaults to the droplets server's element name, read from the core plugin's `api.element()` once the config is resolved; `lit` when there is none. `src/plugin.ts:69`
- Prefix reaches the server and client modules through `virtual:droplets-renderer-lit`. `src/plugin.ts:23`, `src/plugin.ts:94`
- Plugin is named `droplets:lit` and runs with `enforce: "pre"`. `src/plugin.ts:63`, `src/plugin.ts:64`
- Plugin bundles `lit`, `lit-html`, `lit-element`, `@lit/reactive-element`, `@lit-labs/ssr`, `@lit-labs/ssr-client` and `@lit-labs/ssr-dom-shim` into every non-client environment (`noExternal`). `src/plugin.ts:27`, `src/plugin.ts:75`
- Plugin swaps a browser-build file of `lit-html` or `@lit/reactive-element` for its `node/` twin in a server environment resolved without the `node` condition (Workers). `src/plugin.ts:84`, `src/plugin.ts:87`
- Plugin `node/` twin is used only when it exists on disk. `src/plugin.ts:53`
- Tag is `<prefix>-<droplet id>`, and `<prefix>-<droplet id>--error` for the error page. `src/tags.ts:31`
- Tag that is no valid custom element name throws, naming the droplet and `lit({ prefix })`. `src/tags.ts:32`, `src/tags.ts:35`
- Tag of a second class for a name already held is the first free `<tag>--v<n>`, from `--v2`; a name is never defined twice. `src/tags.ts:85`, `src/tags.ts:87`
- Tag a class already defined itself (`@customElement`) is kept, when the registry can name it. `src/tags.ts:70`
- Component that is not a `LitElement` subclass throws `<droplet>: the <kind> component must default-export a LitElement class`. `src/tags.ts:46`, `src/tags.ts:48`
- Server render prints the host template with `render` of `@lit-labs/ssr`, collected to a string, with `deferHydration: true`. `src/render.ts:36`
- Server registry is the `customElements` Lit's DOM shim puts on `globalThis`, read at render time. `src/render.ts:27`
- Host template sets `data`, `form` and `actionUrl` (droplet) or `error` (error page) as properties, never attributes. `src/template.ts:23`, `src/template.ts:25`
- Host template puts the children marker `<div data-droplet-children style="display: contents">` in the element's light DOM. `src/template.ts:25`
- Client hydrate attaches inert `<template shadowrootmode>` roots itself (`attachShadowRoots`), innermost first; a browser without native declarative shadow DOM needs no polyfill for it. `src/client.ts:116`, `src/client.ts:47`
- Client hydrate defines the class under the tag the server markup carries, hydrates with `@lit-labs/ssr-client`, then removes `defer-hydration`. `src/client.ts:123`, `src/client.ts:134`, `src/client.ts:135`
- Client hydrate of a tag another class holds warns `[droplets] <droplet>: <tag> is defined by another class on this page` and mounts afresh. `src/client.ts:125`, `src/client.ts:132`
- Client mount awaits `data`; when it rejects it renders the error page from `handle` (the droplet's `handleError`), nothing when `handle` rejects, and rethrows without an error page. `src/client.ts:79`, `src/client.ts:83`, `src/client.ts:85`, `src/client.ts:81`
- Client mount renders inside `context.rendering` when core gives one, so `actionUrl()` of `$droplets/form` knows the droplet after the await. `src/client.ts:106`
- Client markers skip those of a droplet nested in the children. `src/client.ts:64`
- Client unmount deletes Lit's `_$litPart$` record, then clears the target. `src/client.ts:144`, `src/client.ts:145`
- `update` (clientDev) renders the host template with new props into the same container; it answers false for an error page or a container Lit did not render. `src/client-dev.ts:14`, `src/client-dev.ts:16`
- Client setup imports `@lit-labs/ssr-client/lit-element-hydrate-support.js` for its side effect. `src/client-setup.ts:14`
- `DropletElement` declares `data`, `form` and `actionUrl` with `attribute: false`; `DropletErrorElement` declares `error`. `src/element.ts:34`, `src/element.ts:55`
- `enhance(options?)` of `./form` is an element directive; on any part but an element, or on an element that is not a `<form>`, it throws. `src/form.ts:45`, `src/form.ts:55`
- `enhance` binds when the form is first seen, releases on disconnect and binds again on reconnect; it renders nothing on the server. `src/form.ts:56`, `src/form.ts:79`, `src/form.ts:84`, `src/form.ts:48`
- `enhance` reads its options at each submit; without `onResult` it calls the result's `update()`. `src/form.ts:66`, `src/form.ts:74`
- `enhance` returns Lit's `DirectiveResult<typeof EnhanceDirective>`. `src/form.ts:94`
- Package exports are `.`, `./server`, `./client`, `./element` and `./form`. `package.json:25`, `package.json:38`, `package.json:42`
- Dependencies are `@lit-labs/ssr` and `@lit-labs/ssr-client`; peers `@dropletsjs/droplets`, `lit ^3.3.0`, `vite ^8.0.0`. `package.json:64`, `package.json:68`
- Node engine is `>=22`. `package.json:53`
- Build script runs tsdown, then the tests. `package.json:56`
- graphCheck: client entries `client`, `client-dev`, `client-setup`, `element`, `form`; server `index`, `server`, `plugin`, `render`. `tsdown.config.ts:17`, `tsdown.config.ts:18`
- Tests run under Node with no DOM globals; `test/conformance.test.ts` alone runs under happy-dom, by its pragma, with the stylesheet setting of `happyDom` from the config. `vitest.config.ts:11`, `vitest.config.ts:12`, `test/conformance.test.ts:1`
- Conformance: `rendererConformance({ renderer: lit(), css: false })` on `test/fixtures/conformance`; what only a browser shows is checked by `tests/examples/e2e/lit.spec.ts` in Chromium. `test/conformance.test.ts:12`, `test/conformance.test.ts:17`
- Workers: the fixture built with `cloudflare()` renders in a process without `document` or `HTMLElement`. `test/integration/workers.test.ts:55`

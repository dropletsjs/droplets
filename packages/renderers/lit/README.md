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
import { droplets } from "@dropletsjs/droplets/vite";
import { lit } from "@dropletsjs/renderer-lit";

export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [lit()] })],
});
```

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
  `<template shadowrootmode>` inert. `hydrate` attaches it first
  (`@webcomponents/template-shadowroot`, then a fallback of its own), then
  adopts the nodes without rendering them again.
- **Forms:** `<form method="post" action=${this.actionUrl()}>` posts
  natively. `enhance()` of `@dropletsjs/renderer-lit/form` posts it by fetch
  and updates the droplet in place:
  `<form method="post" action=${this.actionUrl()} ${enhance<DropletActions>()}>`.
- **`hydrate = "interactive"`** works from inside the shadow root: the
  events that start it are composed, and the replayed click reaches the
  element clicked.
- **Cloudflare Workers:** the renderer bundles Lit's server build (`node/`)
  into the server, which runs on Lit's DOM shim and needs no DOM and no Node
  API. Node, Bun, Deno and Workers render alike.
- **No HMR of its own:** under `vite dev` an edit remounts the droplet in
  place, without a page reload, its class defined anew as `<tag>--v2`.

See [Renderers](https://dropletsjs.dev/renderers/lit/).

## Options

```ts
lit({
  prefix: "my-shop", // default: the droplets element name
});
```

MIT

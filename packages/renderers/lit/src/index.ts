/**
 * `@dropletsjs/renderer-lit`: the Lit renderer, web components with
 * declarative shadow DOM.
 *
 * ```ts
 * // vite.config.ts
 * import { droplets } from "@dropletsjs/droplets/vite";
 * import { node } from "@dropletsjs/adapter-node";
 * import { lit } from "@dropletsjs/renderer-lit";
 *
 * export default defineConfig({ plugins: [droplets({ adapter: node(), renderers: [lit()] })] });
 * ```
 *
 * `+droplet.lit.ts` and `+error.lit.ts` (or `.lit.js`) default-export a
 * `LitElement` class; the renderer defines it, as `<element>-<droplet id>`
 * (`<element>-<droplet id>--error` for the error page), `<element>` being
 * the droplets server's element name. Flags are named exports of the file:
 * `export const prerender = true`. The element gets `data` and `form` (or
 * `error`) as properties, and `actionUrl(name?)`, the URL of a form action;
 * the host's children are its light-DOM child: put a `<slot>` where they
 * go. `DropletElement` of `@dropletsjs/renderer-lit/element` declares all
 * of it.
 *
 * ```ts
 * import { css, html } from "lit";
 * import { DropletElement } from "@dropletsjs/renderer-lit/element";
 * import type { DropletProps } from "./$types";
 *
 * export default class Hello extends DropletElement<DropletProps> {
 *   static override styles = css`h1 { color: teal }`;
 *   override render() {
 *     return html`<h1>${this.data.greeting}</h1><slot></slot>`;
 *   }
 * }
 * ```
 *
 * The server renders with `@lit-labs/ssr` into a declarative shadow root;
 * the browser adopts it (`@lit-labs/ssr-client`), after attaching the shadow
 * roots that markup inserted with `innerHTML` left inert. `@lit-labs/ssr`
 * is a Lit Labs package: experimental upstream, shadow DOM components only,
 * no asynchronous rendering. On Cloudflare Workers the renderer uses Lit's
 * server build and DOM shim, which need no Node API.
 *
 * Styles live in the shadow root: `static styles`, printed into the server
 * markup. The droplet's `style.css` and the shared `css.path` stylesheet
 * reach the light DOM only (the element itself and the host's children);
 * inherited properties and custom properties still flow in.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DropletRenderer } from "@dropletsjs/droplets";
import { litPlugin } from "./plugin.ts";

/**
 * The props of `+droplet.lit.ts`, as element properties: `data` from the
 * loads (a value, the renderer waits for it) and, after a form action,
 * `form`.
 */
export type DropletProps<Data = unknown, Form = unknown> = {
  data: Data;
  /** After a form action, what it returned or `fail()`ed with; absent otherwise. */
  form?: Form;
};

/** The props of `+error.lit.ts`: the error out of `handleError`. */
export type DropletErrorProps<Err = unknown> = { error: Err };

export type LitRendererOptions = {
  /**
   * What every component's tag starts with: `<prefix>-<droplet id>`.
   * Default: the droplets server's element name, which already keeps two
   * droplets servers on one page apart (`customElements` is one registry
   * per page).
   */
  prefix?: string;
};

// `src/` and `dist/` both sit directly under the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The Lit renderer, for `droplets({ renderers: [lit()] })`. */
export function lit(options: LitRendererOptions = {}): DropletRenderer {
  if (options.prefix !== undefined && !/^[a-z][a-z0-9._-]*$/.test(options.prefix)) {
    throw new Error(`lit({ prefix }): "${options.prefix}" must start with a lowercase letter: lowercase letters, digits, hyphens`);
  }
  return {
    name: "lit",
    extensions: [".lit.ts", ".lit.js"],
    packages: ["lit", "lit-html", "lit-element", "@lit/reactive-element", "@lit-labs/ssr-client", "@dropletsjs/renderer-lit"],
    componentTypes: "@dropletsjs/renderer-lit",
    plugins: [litPlugin(options.prefix !== undefined ? { prefix: options.prefix } : {})],
    server: resolve(packageRoot, "dist/server.js"),
    client: resolve(packageRoot, "dist/client.js"),
    clientDev: resolve(packageRoot, "dist/client-dev.js"),
    // lit-element-hydrate-support, once per page, before any LitElement is defined.
    clientSetup: resolve(packageRoot, "dist/client-setup.js"),
  };
}

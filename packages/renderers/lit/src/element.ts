/**
 * Base classes for Lit droplets: `LitElement` with the properties the
 * renderer sets, declared once.
 *
 * ```ts
 * // src/droplets/hello/+droplet.lit.ts
 * import { css, html } from "lit";
 * import { DropletElement } from "@dropletsjs/renderer-lit/element";
 * import type { DropletProps } from "./$types";
 *
 * export default class Hello extends DropletElement<DropletProps> {
 *   static override styles = css`h1 { margin: 0 }`;
 *   override render() {
 *     return html`<h1>${this.data.greeting}</h1><slot></slot>`;
 *   }
 * }
 * ```
 *
 * A plain `LitElement` works as well when it declares the same properties
 * (`data`, `form`, `actionUrl`, or `error`) with `attribute: false`.
 * Declare them, never initialise them: a class field would hide the
 * property Lit defines.
 */
import { LitElement, type PropertyDeclarations } from "lit";
import type { ActionUrl } from "@dropletsjs/droplets";

/**
 * A `+droplet.lit.ts` component. `P` is the droplet's `DropletProps` from
 * `./$types`: `data` is what the loads returned (always a value: the
 * renderer waits for it), `form` what the last form action returned or
 * `fail()`ed with. A class: a Lit component extends `LitElement`.
 */
export class DropletElement<P extends { data?: unknown; form?: unknown } = { data: unknown; form?: unknown }> extends LitElement {
  static override properties: PropertyDeclarations = {
    data: { attribute: false },
    form: { attribute: false },
    actionUrl: { attribute: false },
  };

  declare data: Awaited<P["data"]>;
  declare form: P["form"];
  /**
   * The URL of the droplet's form action `name` (`default` without one),
   * the same string on the server and in the browser:
   * `<form method="post" action=${this.actionUrl("add")}>`.
   */
  declare actionUrl: ActionUrl;
}

/**
 * A `+error.lit.ts` component. `P` is the droplet's `DropletErrorProps` from
 * `./$types`. A class: a Lit component extends `LitElement`.
 */
export class DropletErrorElement<P extends { error?: unknown } = { error: unknown }> extends LitElement {
  static override properties: PropertyDeclarations = {
    error: { attribute: false },
  };

  declare error: P["error"];
}

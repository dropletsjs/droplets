/**
 * The one template the renderer renders, on the server and in the browser:
 * the component's element with its props as properties, and the children
 * marker as its light-DOM child, where a `<slot>` in the component's shadow
 * root shows it. The same strings on both sides, so `hydrate` of
 * `@lit-labs/ssr-client` matches the server's markers (Lit compares a
 * digest of them).
 */
import type { ActionUrl, RenderProps } from "@dropletsjs/droplets";
import type { TemplateResult } from "lit";
import { html, unsafeStatic } from "lit/static-html.js";

/**
 * The element the component renders as, with `data` and `form` (a
 * droplet) or `error` (an error page), and `actionUrl`, the URL of one of
 * the droplet's form actions, as properties.
 */
export function hostTemplate(tag: string, props: RenderProps, actionUrl: ActionUrl): TemplateResult {
  const element = unsafeStatic(tag);
  if ("error" in props) {
    return html`<${element} .error=${props.error}><div data-app-children style="display: contents"></div></${element}>`;
  }
  return html`<${element} .data=${props.data} .form=${props.form} .actionUrl=${actionUrl}><div data-app-children style="display: contents"></div></${element}>`;
}

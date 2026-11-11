import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

export type DropletElementProps = {
  /** Tag name of the host element, from `config.element`. */
  element: string;
  /**
   * Droplet id, kebab-cased from its folder name. Where its JavaScript, CSS
   * and data load from is not in the markup: the browser takes it from the
   * URL the page loaded `/index.js` from.
   */
  droplet: string;
  /** Base64 server load result, inlined so hydration skips a round trip. */
  dropletData: string;
  /** Base64 request context, for client-side refetches. */
  dropletContext?: string;
  /** Same payload as `dropletContext`, as an attribute, when no SSR happened. */
  contextAttr?: string | undefined;
  /**
   * A load failed: `html` and `dropletData` belong to `+error.*`, which the
   * client hydrates instead of the droplet.
   */
  error?: boolean | undefined;
  /** The build that rendered it, so a loader from another build can tell. */
  build?: string | undefined;
  /** The id of the server render, for engines that key hydration by it. */
  renderId?: string | undefined;
  /**
   * `/droplets/<id>/style.css` on the public origin, when the droplet has
   * styles: linked inside the element, so its markup never shows unstyled
   * and nothing lands in the host's `<head>`.
   */
  stylesheet?: string | undefined;
  html: string;
};

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

function payloadScript(attribute: string, payload: string): Html | string {
  if (!payload) return "";
  // Payloads are base64, so there is nothing for HTML escaping to change.
  return html`<script type="application/text" ${raw(attribute)}>${raw(payload)}</script>`;
}

/**
 * The droplet itself: a custom element wrapping SSR output plus the payloads
 * the client needs. Served as the fragment at `/droplets/<id>`.
 */
export function dropletElement(props: DropletElementProps): Html {
  const contextAttribute = props.contextAttr ? html` data-context="${props.contextAttr}"` : "";
  const buildAttribute = props.build ? html` data-build="${props.build}"` : "";
  const renderAttribute = props.renderId ? html` data-render-id="${props.renderId}"` : "";
  const errorAttribute = props.error ? raw(" data-droplet-error") : "";

  // The tag name is validated in resolveConfig; it is never user input.
  const tag = raw(props.element);
  return html`<${tag} data-droplet="${props.droplet}"${buildAttribute}${renderAttribute}${contextAttribute}${errorAttribute}>${payloadScript(
    "data-droplet-context",
    props.dropletContext ?? "",
  )}${payloadScript("data-droplet-data", props.dropletData)}${
    props.stylesheet ? html`<link rel="stylesheet" href="${props.stylesheet}" data-droplet-style>` : ""
  }<div style="display: contents" data-droplet-entry>${raw(props.html)}</div></${tag}>`;
}

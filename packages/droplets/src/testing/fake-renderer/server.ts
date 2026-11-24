/**
 * The server side of the fake renderer: a `.fake.js` component is a module
 * whose default export is `(props) => string`. See `../index.ts`.
 */
import type { ComponentModule, RenderProps, ServerRenderContext, ServerRenderOutput } from "../../renderer.ts";
import { FAKE_COMPONENT_NOT_FUNCTION } from "../../errors/browser.ts";
import { dropletsError } from "../../errors/format.ts";

/**
 * A component: its props, `children()` for the marker, and `actionUrl` for
 * where its forms post.
 */
export type FakeComponent = (
  props: Record<string, unknown> & { children: () => string; actionUrl: ServerRenderContext["actionUrl"] },
) => string;

/** What `children()` outputs: the marker the element fills with the host's container. */
export const MARKER = '<div data-droplet-children style="display: contents"></div>';

export function render(module: ComponentModule, props: RenderProps, context: ServerRenderContext): ServerRenderOutput {
  const component = module.default as FakeComponent | undefined;
  if (typeof component !== "function") {
    throw dropletsError({ message: FAKE_COMPONENT_NOT_FUNCTION, params: { kind: context.kind }, droplet: context.droplet });
  }
  // `children` outputs the marker the element fills; nothing else.
  const html = component({ ...props, children: () => MARKER, actionUrl: context.actionUrl });
  // A component may export `head`: HTML that travels with its markup, such
  // as the styles of an error page.
  return typeof module["head"] === "string" ? { html, head: module["head"] } : html;
}

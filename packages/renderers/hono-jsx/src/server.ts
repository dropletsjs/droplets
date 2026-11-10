/**
 * The server side of the Hono JSX renderer: the component as a `hono/jsx`
 * node, printed with `toString()`, which awaits async components. The
 * `children` value is an element that prints the children marker.
 *
 * Styles never travel with the markup, not even for an error page: CSS a
 * `+error.tsx` imports goes through core's extraction with the droplet's own
 * CSS and is served in the droplet's stylesheet.
 */
import type {
  ComponentModule,
  RenderProps,
  ServerRenderContext,
} from "@dropletsjs/droplets";
import type { FC } from "hono/jsx";
// The automatic runtime's `jsx(type, props)`, with `children` in `props`.
import { jsx } from "hono/jsx/jsx-runtime";

function componentOf(module: ComponentModule, context: ServerRenderContext): FC<Record<string, unknown>> {
  const component = module.default;
  if (typeof component !== "function") {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a Hono JSX component`);
  }
  return component as FC<Record<string, unknown>>;
}

export async function render(
  module: ComponentModule,
  props: RenderProps,
  context: ServerRenderContext,
): Promise<string> {
  const component = componentOf(module, context);
  const children = jsx("div", { "data-droplet-children": "", style: "display: contents" });
  return String(await jsx(component, { ...props, children }).toString());
}

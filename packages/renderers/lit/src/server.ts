/**
 * The server side of the Lit renderer: `@lit-labs/ssr` collected to a
 * string (see `render.ts`). Styles travel with the markup by themselves: a
 * component's `static styles` are printed inside its declarative shadow
 * root, error page or not.
 */
import type { ComponentModule, RenderProps, ServerRenderContext } from "@dropletsjs/droplets";
import { prefix } from "virtual:droplets-renderer-lit";
import { renderComponent } from "./render.ts";

export function render(module: ComponentModule, props: RenderProps, context: ServerRenderContext): Promise<string> {
  return renderComponent(module, props, context, prefix);
}

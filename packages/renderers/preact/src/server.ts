/**
 * The server side of the Preact renderer: `renderToString` from
 * `preact-render-to-string`, with the children marker as `children`. It has
 * no Node modules, so the same module runs on Node, Bun, Deno and Workers.
 *
 * Styles never travel with the markup, not even for an error page: Preact
 * components have no inline `<style>` to extract. CSS a `+error.tsx` imports
 * goes through core's extraction with the droplet's own CSS and is served
 * in the droplet's stylesheet, which the element links whenever the droplet
 * is on the page, error page or not.
 */
import type { ComponentModule, RenderProps, ServerRenderContext, ServerRenderOutput } from "@dropletsjs/droplets";
import { h, type ComponentType } from "preact";
import { renderToString } from "preact-render-to-string";
import { childrenElement } from "./children.ts";

function componentOf(module: ComponentModule, context: ServerRenderContext): ComponentType<Record<string, unknown>> {
  const component = module.default;
  if (typeof component !== "function") {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a Preact component`);
  }
  return component as ComponentType<Record<string, unknown>>;
}

export function render(module: ComponentModule, props: RenderProps, context: ServerRenderContext): ServerRenderOutput {
  const component = componentOf(module, context);
  return renderToString(h(component, { ...props, children: childrenElement() }));
}

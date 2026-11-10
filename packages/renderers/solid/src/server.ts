/**
 * The server side of the Solid renderer: `renderToString` from
 * `solid-js/web`, keyed by core's `renderId`, with `children` as a raw SSR
 * node that outputs the children marker.
 */
import type {
  ComponentModule,
  RenderProps,
  ServerRenderContext,
} from "@dropletsjs/droplets";
import { createComponent, type Component } from "solid-js";
import { renderToString, ssr } from "solid-js/web";

/**
 * The empty children marker in the HTML, for the element to fill in the
 * browser. A raw `ssr()` node: Solid prints it as is, without the hydration
 * key it gives the root of a compiled template. A function, like its browser
 * counterpart, so a component can treat `children` the same on both sides.
 */
const children = () => ssr('<div data-droplet-children style="display: contents"></div>');

function componentOf(module: ComponentModule, context: ServerRenderContext): Component<Record<string, unknown>> {
  const component = module.default;
  if (typeof component !== "function") {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a Solid component`);
  }
  return component as Component<Record<string, unknown>>;
}

/** Rendered HTML, with hydration keys that start with `context.renderId`. */
export function render(
  module: ComponentModule,
  props: RenderProps,
  context: ServerRenderContext,
): string {
  const component = componentOf(module, context);
  // The hydration keys start with `renderId`; the browser hydrates with the
  // same id, so several droplets on one page never share keys.
  return renderToString(() => createComponent(component, { ...props, children }), {
    renderId: context.renderId,
  });
}

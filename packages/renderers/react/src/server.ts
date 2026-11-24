/**
 * The server side of the React renderer: `renderToString` from
 * `react-dom/server`, with the children marker as `children`.
 *
 * `react-dom/server` resolves per runtime through its `exports` conditions:
 * the Node build under Node, the edge build (no Node modules) under the
 * `workerd` / `worker` conditions the Cloudflare adapter sets. Both export
 * `renderToString`, so this module stays runtime-neutral.
 *
 * Styles never travel with the markup, not even for an error page: React
 * components have no inline `<style>` to extract. CSS a `+error.tsx` imports
 * goes through core's extraction with the droplet's own CSS and is served
 * in the droplet's stylesheet, which the element links whenever the droplet
 * is on the page, error page or not.
 */
import type { ComponentModule, RenderProps, ServerRenderContext, ServerRenderOutput } from "@dropletsjs/droplets";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { childrenElement } from "./children.ts";
import { COMPONENT_NOT_RENDERABLE, dropletsError } from "@dropletsjs/droplets/errors";

type ComponentOfInput = { module: ComponentModule; context: Pick<ServerRenderContext, "droplet" | "kind"> };

function componentOf({ module, context }: ComponentOfInput): ComponentType<Record<string, unknown>> {
  const component = module.default;
  if (typeof component !== "function" && !(component && typeof component === "object" && "$$typeof" in component)) {
    throw dropletsError({
      message: COMPONENT_NOT_RENDERABLE,
      params: { kind: context.kind, framework: "React" },
      droplet: context.droplet,
    });
  }
  return component as ComponentType<Record<string, unknown>>;
}

export function render(module: ComponentModule, props: RenderProps, context: ServerRenderContext): ServerRenderOutput {
  const component = componentOf({ module, context });
  return renderToString(createElement(component, { ...props, children: childrenElement() }));
}

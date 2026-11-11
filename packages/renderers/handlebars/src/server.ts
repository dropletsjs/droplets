/**
 * The server side of the Handlebars renderer: the compiled template called
 * with `{ data }` or `{ error }` as its context. `{{{children}}}` is a
 * helper of the runtime environment and outputs the children marker;
 * `{{action "add"}}` outputs the URL a form posts to.
 */
import type { ComponentModule, RenderProps, ServerRenderContext, ServerRenderOutput } from "@dropletsjs/droplets";
import { templateOf } from "./runtime.ts";

export function render(module: ComponentModule, props: RenderProps, context: ServerRenderContext): ServerRenderOutput {
  // The context is the props as they are: `{{data.title}}`, `{{error.message}}`.
  // The render's ids travel as data variables: `{{@droplet}}`, `{{@renderId}}`;
  // `actionUrl` with them, for `{{action}}`.
  return templateOf({ module, where: context })(props, {
    data: { droplet: context.droplet, kind: context.kind, renderId: context.renderId, actionUrl: context.actionUrl },
  });
}

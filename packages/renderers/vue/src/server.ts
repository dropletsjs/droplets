/**
 * The server side of the Vue renderer: `createSSRApp` + `renderToString`
 * from `vue/server-renderer`. `DropletChildren` finds no host and renders
 * the bare children marker.
 */
import type { ComponentModule, RenderProps, ServerRenderContext, ServerRenderOutput } from "@dropletsjs/droplets";
import { createSSRApp, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { CHILDREN_KEY } from "./children.ts";

/** A compiled error page in plugin-vue's custom-element mode: its CSS, inlined. */
type WithStyles = { styles?: string[] };

type ComponentOfInput = { module: ComponentModule; context: Pick<ServerRenderContext, "droplet" | "kind"> };

function componentOf({ module, context }: ComponentOfInput): Component {
  const component = module.default;
  if (!component || (typeof component !== "object" && typeof component !== "function")) {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a Vue component`);
  }
  return component as Component;
}

export async function render(module: ComponentModule, props: RenderProps, context: ServerRenderContext): Promise<ServerRenderOutput> {
  const component = componentOf({ module, context });
  const app = createSSRApp(component, props);
  app.provide(CHILDREN_KEY, null);
  const html = await renderToString(app);

  // The error page compiles with its styles inlined (`styles` on the
  // component): they travel with the markup, since a failed droplet's
  // stylesheet may not be the one it needs.
  if (context.kind === "error") {
    const styles = (component as WithStyles).styles;
    const head = Array.isArray(styles) ? styles.map((css) => `<style>${css}</style>`).join("") : "";
    return head ? { html, head } : html;
  }
  return html;
}

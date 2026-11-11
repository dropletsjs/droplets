/**
 * The browser side of the Handlebars renderer. There is no reactivity and
 * nothing to hydrate: `hydrate` keeps the server HTML and hands the host its
 * children markers; `mount` writes the template's HTML first (client-only
 * droplets, error pages rendered in the browser, HMR re-mounts); `unmount`
 * empties the markers, while they are still in the DOM, and then clears the
 * target.
 *
 * A template cannot wait: `mount` waits for a droplet's `data` (a promise
 * when mounting) before it renders, and when it rejects renders the error
 * page in its place, the renderer's error boundary.
 */
import type { ClientRenderContext, ComponentModule, RenderProps } from "@dropletsjs/droplets";
import { templateOf } from "./runtime.ts";

export type Instance = {
  target: HTMLElement;
  context: ClientRenderContext;
  markers: Element[];
  /** The droplet's template, for `update` in dev; absent for an error page. */
  module?: ComponentModule;
};

/** The template's own children markers in `target`, not those of a droplet nested in its markup. */
export function markersIn(target: HTMLElement): Element[] {
  return [...target.querySelectorAll("[data-droplet-children]")].filter((marker) => {
    const owner = marker.closest("[data-droplet]");
    return !owner || !target.contains(owner);
  });
}

function attach(target: HTMLElement, context: ClientRenderContext, markers: Element[]): Instance {
  for (const marker of markers) context.children.fill(marker);
  return { target, context, markers };
}

/** What to render once a droplet's `data` settled: the droplet, its error page, or nothing. */
async function settled(
  module: ComponentModule,
  props: RenderProps,
  context: ClientRenderContext,
): Promise<{ module: ComponentModule; props: RenderProps; kind: ClientRenderContext["kind"] } | null> {
  if (!("data" in props)) return { module, props, kind: context.kind };
  try {
    return { module, props: { ...props, data: await props.data }, kind: context.kind };
  } catch (error) {
    if (!context.error) throw error;
    try {
      return { module: context.error.module, props: { error: await context.error.handle(error) }, kind: "error" };
    } catch {
      return null;
    }
  }
}

export async function mount(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): Promise<Instance> {
  const shown = await settled(module, props, context);
  if (!shown) return { target, context, markers: [] };
  const rendering = { ...context, kind: shown.kind };
  target.innerHTML = templateOf(shown.module, rendering)(shown.props, {
    data: { droplet: context.droplet, kind: shown.kind, renderId: context.renderId, actionUrl: context.actionUrl },
  });
  const instance = attach(target, context, markersIn(target));
  return shown.kind === "droplet" ? { ...instance, module } : instance;
}

export function hydrate(module: ComponentModule, target: HTMLElement, _props: RenderProps, context: ClientRenderContext): Instance {
  // The server markup stays as it is; the element put the host's container
  // in its marker at connect and took it out before this call: `fill` puts
  // it back.
  const markers = context.markers();
  const instance = attach(target, context, markers.length > 0 ? markers : markersIn(target));
  return context.kind === "droplet" ? { ...instance, module } : instance;
}

export function unmount(instance: unknown): void {
  const { target, context, markers } = instance as Instance;
  // The container out first, while its marker is still in the document.
  for (const marker of markers) context.children.empty(marker);
  target.replaceChildren();
}

/**
 * The browser side of the Svelte renderer: `mount`, `hydrate` and `unmount`
 * from `svelte`, with `children` as the marker snippet of `children.svelte`,
 * which finds the element's children host through the component context.
 * A droplet mounted with `data` still to come renders under
 * `boundary.svelte`, which shows `+error.svelte` in place of what throws,
 * when the components compile in async mode (`experimental.async`, which
 * the renderer never turns on). Without it, `mount` waits for the data and
 * shows `+error.svelte` itself when it rejects.
 */
import type { ClientRenderContext, ComponentModule, RenderProps } from "@dropletsjs/droplets";
import { type Component, hydrate as svelteHydrate, mount as svelteMount, unmount as svelteUnmount } from "svelte";
import { asyncMode } from "virtual:droplets-renderer-svelte/options";
import Boundary from "./boundary.svelte";
import { marker } from "./children.svelte";
import { CHILDREN_KEY } from "./children.ts";
import { keep, liveProps } from "./live-props.ts";

type SvelteComponent = Component<Record<string, unknown>>;

type ContextOfInput = Pick<ClientRenderContext, "children">;

type ComponentOfInput = { module: ComponentModule; context: Pick<ClientRenderContext, "droplet" | "kind"> };

type MountSettledInput = {
  component: SvelteComponent;
  target: HTMLElement;
  props: Extract<RenderProps, { data: unknown }>;
  context: ClientRenderContext;
};

type RenderingInput<T> = { context: Pick<ClientRenderContext, "rendering">; render: () => T };

/** The root context: where `use:fill` in the marker finds the element's host. */
function contextOf({ children }: ContextOfInput): Map<symbol, unknown> {
  return new Map([[CHILDREN_KEY, children]]);
}

function componentOf({ module, context }: ComponentOfInput): SvelteComponent {
  const component = module.default;
  if (typeof component !== "function") {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a Svelte component`);
  }
  return component as SvelteComponent;
}

export function mount(module: ComponentModule, target: HTMLElement, props: RenderProps, context: ClientRenderContext): unknown {
  const component = componentOf({ module, context });
  if (!asyncMode && "data" in props) return mountSettled({ component, target, props, context });
  if (!("data" in props)) {
    return svelteMount(component, { target, props: { ...props, children: marker }, context: contextOf(context) });
  }
  const live = liveProps({ props, extra: { children: marker } });
  if (context.error) {
    const errorComponent = componentOf({ module: context.error.module, context: { ...context, kind: "error" } });
    return keep({
      instance: svelteMount(Boundary, {
        target,
        props: { component, props: live.props, errorComponent, handle: context.error.handle, children: marker },
        context: contextOf(context),
      }),
      set: live.set,
    });
  }
  return keep({ instance: svelteMount(component, { target, props: live.props, context: contextOf(context) }), set: live.set });
}

/**
 * Without async mode a component cannot `await` its `data`: it mounts once
 * the data is in, or `+error.svelte` does when it rejects; nothing when
 * `handle` rejects as well.
 */
async function mountSettled({ component, target, props, context }: MountSettledInput): Promise<unknown> {
  let data: unknown;
  try {
    data = await props.data;
  } catch (error) {
    if (!context.error) throw error;
    let shown: unknown;
    try {
      shown = await context.error.handle(error);
    } catch {
      // `handleError` rejected: there is no error to show.
      return null;
    }
    const errorComponent = componentOf({ module: context.error.module, context: { ...context, kind: "error" } });
    return rendering({
      context,
      render: () => svelteMount(errorComponent, { target, props: { error: shown, children: marker }, context: contextOf(context) }),
    });
  }
  const live = liveProps({ props: { ...props, data }, extra: { children: marker } });
  return keep({
    instance: rendering({ context, render: () => svelteMount(component, { target, props: live.props, context: contextOf(context) }) }),
    set: live.set,
  });
}

/** After the await, as the render again: `actionUrl()` of `$droplets/form` in the component knows it. */
function rendering<T>({ context, render }: RenderingInput<T>): T {
  return context.rendering ? context.rendering(render) : render();
}

export function hydrate(module: ComponentModule, target: HTMLElement, props: RenderProps, context: ClientRenderContext): unknown {
  const component = componentOf({ module, context });
  // The server rendered the marker and the element emptied it before this
  // call: the snippet adopts it, and `use:fill` puts the container back.
  if (!("data" in props)) {
    return svelteHydrate(component, { target, props: { ...props, children: marker }, context: contextOf(context) });
  }
  const live = liveProps({ props, extra: { children: marker } });
  return keep({ instance: svelteHydrate(component, { target, props: live.props, context: contextOf(context) }), set: live.set });
}

export async function unmount(instance: unknown): Promise<void> {
  // `null`: an error page whose `handle` rejected, nothing mounted.
  if (instance) await svelteUnmount(instance as Record<string, unknown>);
}

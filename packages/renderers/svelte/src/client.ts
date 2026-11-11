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
import type {
  ClientRenderContext,
  ComponentModule,
  RenderProps,
} from "@dropletsjs/droplets";
import {
  hydrate as svelteHydrate,
  mount as svelteMount,
  unmount as svelteUnmount,
  type Component,
} from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { asyncMode } from "virtual:droplets-renderer-svelte/options";
import Boundary from "./boundary.svelte";
import { marker } from "./children.svelte";
import { CHILDREN_KEY } from "./children.ts";

/** Each instance's props setter, for `update`. */
const setters = new WeakMap<object, (props: RenderProps) => void>();

/**
 * A droplet's props as getters over a reactive map: the component reads
 * `data` and `form` through them, so `update` changes them in place, with
 * no new instance. `extra` (the `children` snippet) stays as it is.
 */
function liveProps(props: RenderProps, extra: Record<string, unknown>): { props: Record<string, unknown>; set: (props: RenderProps) => void } {
  const values = new SvelteMap<string, unknown>(Object.entries(props));
  const live: Record<string, unknown> = { ...extra };
  for (const key of ["data", "form"]) {
    Object.defineProperty(live, key, { enumerable: true, get: () => values.get(key) });
  }
  return {
    props: live,
    set(next) {
      const record = next as Record<string, unknown>;
      for (const key of ["data", "form"]) {
        if (Object.hasOwn(record, key)) values.set(key, record[key]);
        else values.delete(key);
      }
    },
  };
}

/** `instance`, its props setter kept for `update`. */
function keep<T>(instance: T, set: (props: RenderProps) => void): T {
  if (instance && typeof instance === "object") setters.set(instance, set);
  return instance;
}

/** The root context: where `use:fill` in the marker finds the element's host. */
function contextOf(context: ClientRenderContext): Map<symbol, unknown> {
  return new Map([[CHILDREN_KEY, context.children]]);
}

function componentOf(module: ComponentModule, context: ClientRenderContext): Component<Record<string, unknown>> {
  const component = module.default;
  if (typeof component !== "function") {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a Svelte component`);
  }
  return component as Component<Record<string, unknown>>;
}

export function mount(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): unknown {
  const component = componentOf(module, context);
  if (!asyncMode && "data" in props) return mountSettled(component, target, props, context);
  if (!("data" in props)) {
    return svelteMount(component, { target, props: { ...props, children: marker }, context: contextOf(context) });
  }
  const live = liveProps(props, { children: marker });
  if (context.error) {
    const errorComponent = componentOf(context.error.module, { ...context, kind: "error" });
    return keep(svelteMount(Boundary, {
      target,
      props: { component, props: live.props, errorComponent, handle: context.error.handle, children: marker },
      context: contextOf(context),
    }), live.set);
  }
  return keep(svelteMount(component, {
    target,
    props: live.props,
    context: contextOf(context),
  }), live.set);
}

/**
 * Without async mode a component cannot `await` its `data`: it mounts once
 * the data is in, or `+error.svelte` does when it rejects; nothing when
 * `handle` rejects as well.
 */
async function mountSettled(
  component: Component<Record<string, unknown>>,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): Promise<unknown> {
  let data: unknown;
  try {
    data = await (props as { data: unknown }).data;
  } catch (error) {
    if (!context.error) throw error;
    let shown: unknown;
    try {
      shown = await context.error.handle(error);
    } catch {
      return null;
    }
    const errorComponent = componentOf(context.error.module, { ...context, kind: "error" });
    return rendering(context, () =>
      svelteMount(errorComponent, { target, props: { error: shown, children: marker }, context: contextOf(context) })
    );
  }
  const live = liveProps({ ...props, data } as RenderProps, { children: marker });
  return keep(rendering(context, () =>
    svelteMount(component, { target, props: live.props, context: contextOf(context) })
  ), live.set);
}

/** After the await, as the render again: `actionUrl()` of `$droplets/form` in the component knows it. */
function rendering<T>(context: ClientRenderContext, render: () => T): T {
  return context.rendering ? context.rendering(render) : render();
}

export function hydrate(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): unknown {
  // The server rendered the marker and the element emptied it before this
  // call: the snippet adopts it, and `use:fill` puts the container back.
  if (!("data" in props)) {
    return svelteHydrate(componentOf(module, context), { target, props: { ...props, children: marker }, context: contextOf(context) });
  }
  const live = liveProps(props, { children: marker });
  return keep(svelteHydrate(componentOf(module, context), {
    target,
    props: live.props,
    context: contextOf(context),
  }), live.set);
}

/**
 * New `data` (and `form`) for a live droplet: its props change in place,
 * and the component keeps its state. Without async mode the component
 * never waits for `data`: it gets the value, as when it mounted.
 */
export async function update(instance: unknown, props: RenderProps): Promise<boolean> {
  const set = instance && typeof instance === "object" ? setters.get(instance) : undefined;
  if (!set) return false;
  const value = !asyncMode && "data" in props ? { ...props, data: await props.data } : props;
  set(value as RenderProps);
  return true;
}

export async function unmount(instance: unknown): Promise<void> {
  // `null`: an error page whose `handle` rejected, nothing mounted.
  if (instance) await svelteUnmount(instance as Record<string, unknown>);
}

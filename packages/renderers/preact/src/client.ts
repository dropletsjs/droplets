/**
 * The browser side of the Preact renderer: `hydrate` adopts the server's
 * markup, `render` mounts, `render(null, target)` tears down. The instance
 * handle is the target. Preact renders synchronously, so the component is
 * committed (and the children marker filled) when `mount` or `hydrate`
 * returns.
 *
 * Preact has no `use(promise)`: a droplet's `data`, a promise when the
 * element mounts it fresh (client-only, refreshed, re-mounted), is awaited
 * here before the component renders, so a Preact component always receives
 * the value, as when it hydrates. When it rejects and the droplet has an
 * error page, `+error.tsx` renders in its place with what `handleError`
 * made of it; nothing renders when `handleError` rejects.
 *
 * A droplet mounted with an error page also renders inside an error
 * boundary, which shows `+error.tsx` in place of whatever throws while
 * rendering later on.
 */
import type {
  ClientRenderContext,
  ComponentModule,
  RenderProps,
} from "@dropletsjs/droplets";
import { hydrate as preactHydrate, render as preactRender } from "preact";
import { componentOf, isThenable, tree, type AnyComponent } from "./tree.ts";

/** What `mount` and `hydrate` return, for `unmount`, and for `update` in dev what they rendered. */
export type PreactInstance = { target: HTMLElement; component?: AnyComponent; context?: ClientRenderContext };

/** The page with its props once `data` settled: the droplet, its error page, or `null` for nothing. */
async function settled(
  component: AnyComponent,
  props: RenderProps & { data: PromiseLike<unknown> },
  context: ClientRenderContext,
): Promise<{ component: AnyComponent; props: RenderProps; context: ClientRenderContext } | null> {
  try {
    return { component, props: { ...props, data: await props.data }, context };
  } catch (error) {
    if (!context.error) throw error;
    const errorComponent = componentOf(context.error.module, { ...context, kind: "error" });
    // The error page is the boundary's: it gets none of its own.
    const { error: _boundary, ...rest } = context;
    try {
      return { component: errorComponent, props: { error: await context.error.handle(error) }, context: { ...rest, kind: "error" } };
    } catch {
      return null;
    }
  }
}

export function mount(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): PreactInstance | Promise<PreactInstance> {
  const component = componentOf(module, context);
  if (!("data" in props) || !isThenable(props.data)) {
    preactRender(tree(component, props, context), target);
    return { target, component, context };
  }
  return settled(component, props as RenderProps & { data: PromiseLike<unknown> }, context).then((shown) => {
    if (shown) {
      const run = () => preactRender(tree(shown.component, shown.props, shown.context), target);
      // After the `await`: `actionUrl()` of `$droplets/form` must still know the droplet.
      if (context.rendering) context.rendering(run);
      else run();
      // The error page shows: it takes no new data.
      if (shown.component === component) return { target, component, context };
    }
    return { target };
  });
}

export function hydrate(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): PreactInstance {
  const component = componentOf(module, context);
  // Preact adopts the server's nodes as they are; the element emptied the
  // marker before this call, and the container returns through `fill` once
  // the adopted marker is committed.
  preactHydrate(tree(component, props, context), target);
  return { target, component, context };
}

export function unmount(instance: unknown): void {
  preactRender(null, (instance as PreactInstance).target);
}

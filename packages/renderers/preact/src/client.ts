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
import {
  Component,
  h,
  hydrate as preactHydrate,
  render as preactRender,
  type ComponentChildren,
  type ComponentType,
  type VNode,
} from "preact";
import { childrenElement, ChildrenHostContext } from "./children.ts";

type AnyComponent = ComponentType<Record<string, unknown>>;

/** What `mount` and `hydrate` return, for `unmount`, and for `update` what they rendered. */
export type PreactInstance = { target: HTMLElement; component?: AnyComponent; context?: ClientRenderContext };

function componentOf(module: ComponentModule, context: ClientRenderContext): AnyComponent {
  const component = module.default;
  if (typeof component !== "function") {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a Preact component`);
  }
  return component as AnyComponent;
}

type BoundaryProps = {
  page: AnyComponent;
  handle: (error: unknown) => Promise<unknown>;
  children?: ComponentChildren;
};
type BoundaryState = { failed: boolean; shown?: { error: unknown } };

/**
 * The error boundary of a mounted droplet: what throws while rendering
 * goes through `handle` (the droplet's `handleError`) into the error page,
 * rendered in its place; nothing while `handle` runs, or when it rejects.
 */
class DropletBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.handle(error).then(
      (shown) => this.setState({ shown: { error: shown } }),
      () => undefined,
    );
  }

  override render(): ComponentChildren {
    if (!this.state.failed) return this.props.children;
    if (!this.state.shown) return null;
    return h(this.props.page, { error: this.state.shown.error, children: childrenElement() });
  }
}

/** The component with its props, under the provider that gives `children` the element's host. */
function tree(component: AnyComponent, props: RenderProps, context: ClientRenderContext): VNode<any> {
  let node: VNode<any> = h(component, { ...props, children: childrenElement() });
  if (context.error) {
    const page = componentOf(context.error.module, { ...context, kind: "error" });
    node = h(DropletBoundary, { page, handle: context.error.handle }, node);
  }
  return h(ChildrenHostContext.Provider, { value: context.children }, node);
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as { then?: unknown } | null)?.then === "function";

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
    const page = componentOf(context.error.module, { ...context, kind: "error" });
    // The error page is the boundary's: it gets none of its own.
    const { error: _boundary, ...rest } = context;
    try {
      return { component: page, props: { error: await context.error.handle(error) }, context: { ...rest, kind: "error" } };
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

/**
 * The same tree with new props, rendered into the same target: Preact
 * diffs it against what is there, and the component keeps its state.
 * `data` is always the value, as on mount.
 */
export async function update(instance: unknown, props: RenderProps): Promise<boolean> {
  const { target, component, context } = instance as PreactInstance;
  if (!component || !context) return false;
  const next = "data" in props && isThenable(props.data) ? { ...props, data: await props.data } : props;
  preactRender(tree(component, next, context), target);
  return true;
}

export function unmount(instance: unknown): void {
  preactRender(null, (instance as PreactInstance).target);
}

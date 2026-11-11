/**
 * The tree a Preact droplet renders, for `client.ts` and `client-dev.ts`:
 * the component with its props, under the error boundary when it has one.
 */
import type { ClientRenderContext, ComponentModule, RenderProps } from "@dropletsjs/droplets";
import { Component, h, type ComponentChildren, type ComponentType, type VNode } from "preact";
import { childrenElement, ChildrenHostContext } from "./children.ts";

export type AnyComponent = ComponentType<Record<string, unknown>>;

export function componentOf(module: ComponentModule, context: ClientRenderContext): AnyComponent {
  const component = module.default;
  if (typeof component !== "function") {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a Preact component`);
  }
  return component as AnyComponent;
}

type BoundaryProps = {
  errorComponent: AnyComponent;
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
    return h(this.props.errorComponent, { error: this.state.shown.error, children: childrenElement() });
  }
}

/** The component with its props, under the provider that gives `children` the element's host. */
export function tree(component: AnyComponent, props: RenderProps, context: ClientRenderContext): VNode<any> {
  let node: VNode<any> = h(component, { ...props, children: childrenElement() });
  if (context.error) {
    const errorComponent = componentOf(context.error.module, { ...context, kind: "error" });
    node = h(DropletBoundary, { errorComponent, handle: context.error.handle }, node);
  }
  return h(ChildrenHostContext.Provider, { value: context.children }, node);
}

export const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as { then?: unknown } | null)?.then === "function";

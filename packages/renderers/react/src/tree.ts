/**
 * The tree a React droplet renders, for `client.ts` and `client-dev.ts`:
 * the component with its props, under the error boundary when it has one.
 */
import type { ClientRenderContext, ComponentModule, RenderProps } from "@dropletsjs/droplets";
import { Component, createElement, Suspense, type ComponentType, type ReactElement, type ReactNode } from "react";
import { childrenElement, ChildrenHostContext } from "./children.ts";

export function componentOf(module: ComponentModule, context: ClientRenderContext): ComponentType<Record<string, unknown>> {
  const component = module.default;
  if (typeof component !== "function" && !(component && typeof component === "object" && "$$typeof" in component)) {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a React component`);
  }
  return component as ComponentType<Record<string, unknown>>;
}

type BoundaryProps = {
  errorComponent: ComponentType<Record<string, unknown>>;
  handle: (error: unknown) => Promise<unknown>;
  children?: ReactNode;
};
type BoundaryState = { failed: boolean; shown?: { error: unknown } };

/**
 * The error boundary of a mounted droplet: what throws while rendering
 * goes through `handle` (the droplet's `handleError`) into the error page,
 * rendered in its place; nothing while `handle` runs, or when it rejects.
 */
export class DropletBoundary extends Component<BoundaryProps, BoundaryState> {
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

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (!this.state.shown) return null;
    return createElement(this.props.errorComponent, { error: this.state.shown.error, children: childrenElement() });
  }
}

/** The component with its props, under the provider that gives `children` the element's host. */
export function tree(component: ComponentType<Record<string, unknown>>, props: RenderProps, context: ClientRenderContext): ReactElement {
  let node: ReactElement = createElement(component, { ...props, children: childrenElement() });
  if (context.error) {
    const errorComponent = componentOf(context.error.module, { ...context, kind: "error" });
    node = createElement(
      DropletBoundary,
      { errorComponent, handle: context.error.handle },
      createElement(Suspense, { fallback: null }, node),
    );
  }
  return createElement(ChildrenHostContext.Provider, { value: context.children }, node);
}

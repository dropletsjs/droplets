/**
 * The tree a React droplet renders, for `client.ts` and `client-dev.ts`:
 * the component with its props, under the error boundary when it has one.
 */
import type { ClientRenderContext, ComponentModule, RenderProps } from "@dropletsjs/droplets";
import { Component, type ComponentType, createElement, type ReactElement, type ReactNode, Suspense } from "react";
import { ChildrenHostContext, childrenElement } from "./children.ts";

export type AnyComponent = ComponentType<Record<string, unknown>>;

type ComponentOfInput = { module: ComponentModule; context: Pick<ClientRenderContext, "droplet" | "kind"> };

type TreeInput = { component: AnyComponent; props: RenderProps; context: ClientRenderContext };

type BoundaryProps = {
  errorComponent: AnyComponent;
  handle: (error: unknown) => Promise<unknown>;
  children?: ReactNode;
};
type BoundaryState = { failed: boolean; shown?: { error: unknown } };

export function componentOf({ module, context }: ComponentOfInput): AnyComponent {
  const component = module.default;
  if (typeof component !== "function" && !(component && typeof component === "object" && "$$typeof" in component)) {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a React component`);
  }
  return component as AnyComponent;
}

/**
 * The error boundary of a mounted droplet: what throws while rendering
 * goes through `handle` (the droplet's `handleError`) into the error page,
 * rendered in its place; nothing while `handle` runs, or when it rejects.
 * A class: React has error boundaries only as class components.
 */
export class DropletBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.handle(error).then(
      (shown) => this.setState({ shown: { error: shown } }),
      // `handleError` rejected: the boundary shows nothing.
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
export function tree({ component, props, context }: TreeInput): ReactElement {
  let node: ReactElement = createElement(component, { ...props, children: childrenElement() });
  if (context.error) {
    const errorComponent = componentOf({ module: context.error.module, context: { ...context, kind: "error" } });
    node = createElement(
      DropletBoundary,
      { errorComponent, handle: context.error.handle },
      createElement(Suspense, { fallback: null }, node),
    );
  }
  return createElement(ChildrenHostContext.Provider, { value: context.children }, node);
}

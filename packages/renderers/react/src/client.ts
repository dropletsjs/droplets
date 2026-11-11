/**
 * The browser side of the React renderer: `hydrateRoot` hydrates,
 * `createRoot().render()` mounts, `root.unmount()` tears down. The instance
 * handle is the root.
 *
 * Both run inside `flushSync`, so the component is committed when `mount`
 * or `hydrate` returns: the host's container, which the element took out of
 * the server-rendered marker before React compares the DOM, is back in it
 * within the same task, before the page paints, and a `+droplet.tsx` that
 * another droplet depends on never shows up half-way.
 *
 * React's error callbacks are routed to the console with the droplet's
 * name, never swallowed: a hydration mismatch or an error React recovered
 * from shows up as `onRecoverableError`, an error no boundary caught as
 * `onUncaughtError`, one a boundary of the component caught as
 * `onCaughtError` (core reports what the droplet's own boundary catches).
 *
 * A droplet mounted with `data` still to come renders under `<Suspense>`
 * (for `use(data)`) inside an error boundary, which shows `+error.tsx` in
 * place of whatever throws while rendering, a rejected `use(data)` included.
 */
import type {
  ClientRenderContext,
  ComponentModule,
  RenderProps,
} from "@dropletsjs/droplets";
import {
  Component,
  createElement,
  Suspense,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot, type Root, type RootOptions } from "react-dom/client";
import { childrenElement, ChildrenHostContext } from "./children.ts";

function componentOf(module: ComponentModule, context: ClientRenderContext): ComponentType<Record<string, unknown>> {
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

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (!this.state.shown) return null;
    return createElement(this.props.errorComponent, { error: this.state.shown.error, children: childrenElement() });
  }
}

/** The component with its props, under the provider that gives `children` the element's host. */
function tree(component: ComponentType<Record<string, unknown>>, props: RenderProps, context: ClientRenderContext): ReactElement {
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

function rootOptions(context: ClientRenderContext): RootOptions {
  const where = `[droplets] ${context.droplet} (${context.kind}, react)`;
  return {
    onRecoverableError(error, info) {
      console.error(`${where}: React recovered from an error`, error, info.componentStack ?? "");
    },
    onUncaughtError(error, info) {
      console.error(`${where}: uncaught error in the component`, error, info.componentStack ?? "");
    },
    onCaughtError(error, info) {
      // The droplet's own boundary: core reports it as it shows +error.tsx.
      if (info.errorBoundary instanceof DropletBoundary) return;
      console.error(`${where}: error caught by a boundary in the component`, error, info.componentStack ?? "");
    },
  };
}

/** What a root renders, for `update`: the same component and context, with new props. */
const rendered = new WeakMap<Root, { component: ComponentType<Record<string, unknown>>; context: ClientRenderContext }>();

export function mount(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): Root {
  const component = componentOf(module, context);
  const root = createRoot(target, rootOptions(context));
  flushSync(() => root.render(tree(component, props, context)));
  rendered.set(root, { component, context });
  return root;
}

export function hydrate(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): Root {
  const component = componentOf(module, context);
  // React compares the DOM with its element tree; the element emptied the
  // server-rendered marker before this call, and the container returns
  // through `fill` once the adopted marker is committed.
  let root: Root | undefined;
  flushSync(() => {
    root = hydrateRoot(target, tree(component, props, context), rootOptions(context));
  });
  rendered.set(root!, { component, context });
  return root!;
}

/** The same tree with new props: React reconciles it, and the component keeps its state. */
export function update(instance: unknown, props: RenderProps): boolean {
  const root = instance as Root;
  const known = rendered.get(root);
  if (!known) return false;
  flushSync(() => root.render(tree(known.component, props, known.context)));
  return true;
}

export function unmount(instance: unknown): void {
  (instance as Root).unmount();
}

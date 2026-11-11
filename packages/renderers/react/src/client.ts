/**
 * The browser side of the React renderer: `hydrateRoot` hydrates,
 * `createRoot().render()` mounts, `root.unmount()` tears down. The instance
 * handle is the root, with what it renders.
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
import type { ComponentType } from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot, type Root, type RootOptions } from "react-dom/client";
import { componentOf, DropletBoundary, tree } from "./tree.ts";

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

/** What `mount` and `hydrate` return: the root, and what it renders for `update` in dev. */
export type ReactInstance = { root: Root; component: ComponentType<Record<string, unknown>>; context: ClientRenderContext };

export function mount(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): ReactInstance {
  const component = componentOf(module, context);
  const root = createRoot(target, rootOptions(context));
  flushSync(() => root.render(tree(component, props, context)));
  return { root, component, context };
}

export function hydrate(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): ReactInstance {
  const component = componentOf(module, context);
  // React compares the DOM with its element tree; the element emptied the
  // server-rendered marker before this call, and the container returns
  // through `fill` once the adopted marker is committed.
  let root: Root | undefined;
  flushSync(() => {
    root = hydrateRoot(target, tree(component, props, context), rootOptions(context));
  });
  return { root: root!, component, context };
}

export function unmount(instance: unknown): void {
  (instance as ReactInstance).root.unmount();
}

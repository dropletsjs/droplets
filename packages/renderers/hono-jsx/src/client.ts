/**
 * The browser side of the Hono JSX renderer: `createRoot` from
 * `hono/jsx/dom/client` renders, `root.unmount()`, flushed, tears down.
 * The instance handle is the root, with what it renders.
 *
 * `hono/jsx/dom` cannot adopt server markup, so `hydrate` empties the
 * element's content and renders afresh, synchronously: the page never
 * paints the gap. The markers the server rendered go with it; the new one
 * is filled from its layout effect.
 *
 * Everything renders under `<Suspense>` (for `use(data)` when `data` is a
 * promise); a droplet mounted with an error page renders inside an
 * `<ErrorBoundary>` as well, which shows `+error.tsx` in place of whatever
 * throws while rendering, a rejected `use(data)` included.
 */
import type { ClientRenderContext, ComponentModule, RenderProps } from "@dropletsjs/droplets";
import { flushSync, type FC } from "hono/jsx/dom";
import { createRoot, type Root } from "hono/jsx/dom/client";
import { componentOf, tree } from "./tree.ts";

/** What `mount` and `hydrate` return: the root, and what it renders for `update` in dev. */
export type HonoInstance = { root: Root; component: FC<Record<string, unknown>>; context: ClientRenderContext };

export function mount(module: ComponentModule, target: HTMLElement, props: RenderProps, context: ClientRenderContext): HonoInstance {
  const component = componentOf({ module, context });
  const root = createRoot(target);
  root.render(tree({ component, props, context }));
  return { root, component, context };
}

export function hydrate(module: ComponentModule, target: HTMLElement, props: RenderProps, context: ClientRenderContext): HonoInstance {
  // The server's markup goes; the same output takes its place in this task.
  target.replaceChildren();
  return mount(module, target, props, context);
}

// Hono's `unmount` is a state update, applied later; flushed here, so the
// element is empty when this returns, as core expects before a remount.
export function unmount(instance: unknown): void {
  flushSync(() => (instance as HonoInstance).root.unmount());
}

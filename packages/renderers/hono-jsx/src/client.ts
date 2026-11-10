/**
 * The browser side of the Hono JSX renderer: `createRoot` from
 * `hono/jsx/dom/client` renders, `root.unmount()`, flushed, tears down.
 * The instance handle is the root.
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
import type {
  ClientRenderContext,
  ComponentModule,
  DropletChildrenHost,
  RenderProps,
} from "@dropletsjs/droplets";
import { ErrorBoundary, flushSync, Suspense, use, useLayoutEffect, useRef, type Child, type FC } from "hono/jsx/dom";
import { createRoot, type Root } from "hono/jsx/dom/client";
// The automatic runtime's `jsx(type, props)`: `children` in `props`. The
// `jsx` of `hono/jsx/dom` is `createElement`, which takes them as arguments.
import { Fragment, jsx } from "hono/jsx/dom/jsx-runtime";

/**
 * What a `<Suspense>` shows while waiting: nothing. Not `null`, which Hono
 * takes for "no fallback here" and passes the wait on, past the boundary.
 * A fresh node each time: Hono keeps its state on the nodes it renders.
 */
const nothing = () => jsx(Fragment, {});

function componentOf(module: ComponentModule, context: ClientRenderContext): FC<Record<string, unknown>> {
  const component = module.default;
  if (typeof component !== "function") {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a Hono JSX component`);
  }
  return component as FC<Record<string, unknown>>;
}

/**
 * The `children` value: an element that renders the marker, filled by the
 * element once rendered and emptied before it goes away. Hono runs layout
 * cleanups while the old nodes are still in the document.
 */
function childrenOf(host: DropletChildrenHost): Child {
  function DropletChildren() {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      const marker = ref.current;
      if (!marker) return;
      host.fill(marker);
      return () => host.empty(marker);
    }, []);
    return jsx("div", { ref, "data-droplet-children": "", style: "display: contents" });
  }
  return jsx(DropletChildren, {});
}

/** The error page with what `handle` made of `error`; nothing while it runs, or when it rejects. */
function errorPageOf(page: FC<Record<string, unknown>>, context: ClientRenderContext, handle: (error: unknown) => Promise<unknown>) {
  const shown = new Map<unknown, Promise<{ error: unknown } | null>>();
  function HandledError({ error }: { error: unknown }) {
    if (!shown.has(error)) shown.set(error, handle(error).then((handled) => ({ error: handled }), () => null));
    const result = use(shown.get(error)!);
    return result ? jsx(page, { error: result.error, children: childrenOf(context.children) }) : null;
  }
  return (error: unknown) => jsx(Suspense, { fallback: nothing(), children: jsx(HandledError, { error }) });
}

/**
 * `data` for the component when it is a promise: the same settlement, with
 * a `finally` whose own promise is handled. Hono's `<Suspense>` calls
 * `finally` on the promise it waits for and drops the result, which rejects
 * along with `data`: an unhandled rejection for every load that fails,
 * though the error boundary shows it.
 */
function quiet(data: Promise<unknown>): Promise<unknown> {
  const promise = data.then();
  promise.finally = (onFinally) => {
    const settled = Promise.prototype.finally.call(promise, onFinally);
    settled.catch(() => undefined);
    return settled;
  };
  return promise;
}

function tree(component: FC<Record<string, unknown>>, props: RenderProps, context: ClientRenderContext): Child {
  const data = "data" in props && props.data instanceof Promise ? { data: quiet(props.data) } : {};
  const node = jsx(Suspense, {
    fallback: nothing(),
    children: jsx(component, { ...props, ...data, children: childrenOf(context.children) }),
  });
  if (!context.error) return node;
  const page = componentOf(context.error.module, { ...context, kind: "error" });
  return jsx(ErrorBoundary, { fallbackRender: errorPageOf(page, context, context.error.handle), children: node });
}

/** What a root renders, for `update`: the same component and context, with new props. */
const rendered = new WeakMap<Root, { component: FC<Record<string, unknown>>; context: ClientRenderContext }>();

export function mount(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): Root {
  const component = componentOf(module, context);
  const root = createRoot(target);
  root.render(tree(component, props, context));
  rendered.set(root, { component, context });
  return root;
}

/** The same tree with new props: Hono reconciles it, and the component keeps its state. */
export function update(instance: unknown, props: RenderProps): boolean {
  const root = instance as Root;
  const known = rendered.get(root);
  if (!known) return false;
  flushSync(() => root.render(tree(known.component, props, known.context)));
  return true;
}

export function hydrate(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): Root {
  // The server's markup goes; the same output takes its place in this task.
  target.replaceChildren();
  return mount(module, target, props, context);
}

// Hono's `unmount` is a state update, applied later; flushed here, so the
// element is empty when this returns, as core expects before a remount.
export function unmount(instance: unknown): void {
  flushSync(() => (instance as Root).unmount());
}

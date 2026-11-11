/**
 * The tree a Hono JSX droplet renders, for `client.ts` and `client-dev.ts`:
 * the component under `<Suspense>`, and under the error boundary when it has
 * an error page.
 */
import type { ClientRenderContext, ComponentModule, DropletChildrenHost, RenderProps } from "@dropletsjs/droplets";
import { ErrorBoundary, Suspense, use, useLayoutEffect, useRef, type Child, type FC } from "hono/jsx/dom";
// The automatic runtime's `jsx(type, props)`: `children` in `props`. The
// `jsx` of `hono/jsx/dom` is `createElement`, which takes them as arguments.
import { Fragment, jsx } from "hono/jsx/dom/jsx-runtime";

/**
 * What a `<Suspense>` shows while waiting: nothing. Not `null`, which Hono
 * takes for "no fallback here" and passes the wait on, past the boundary.
 * A fresh node each time: Hono keeps its state on the nodes it renders.
 */
function nothing(): Child {
  return jsx(Fragment, {});
}

type ComponentOfInput = { module: ComponentModule; context: Pick<ClientRenderContext, "droplet" | "kind"> };

export function componentOf({ module, context }: ComponentOfInput): FC<Record<string, unknown>> {
  const component = module.default;
  if (typeof component !== "function") {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a Hono JSX component`);
  }
  return component as FC<Record<string, unknown>>;
}

type ChildrenOfInput = { host: DropletChildrenHost };

/**
 * The `children` value: an element that renders the marker, filled by the
 * element once rendered and emptied before it goes away. Hono runs layout
 * cleanups while the old nodes are still in the document.
 */
function childrenOf({ host }: ChildrenOfInput): Child {
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

type ErrorComponentOfInput = {
  errorComponent: FC<Record<string, unknown>>;
  context: ClientRenderContext;
  handle: (error: unknown) => Promise<unknown>;
};

type HandledErrorProps = { error: unknown };

/** The error page with what `handle` made of `error`; nothing while it runs, or when it rejects. */
function errorComponentOf({ errorComponent, context, handle }: ErrorComponentOfInput): (error: unknown) => Child {
  const shown = new Map<unknown, Promise<{ error: unknown } | null>>();
  function HandledError({ error }: HandledErrorProps) {
    let pending = shown.get(error);
    if (!pending) {
      pending = handle(error).then(
        (handled) => ({ error: handled }),
        () => null,
      );
      shown.set(error, pending);
    }
    const result = use(pending);
    return result ? jsx(errorComponent, { error: result.error, children: childrenOf({ host: context.children }) }) : null;
  }
  return (error: unknown) => jsx(Suspense, { fallback: nothing(), children: jsx(HandledError, { error }) });
}

type QuietInput = { data: Promise<unknown> };

/**
 * `data` for the component when it is a promise: the same settlement, with
 * a `finally` whose own promise is handled. Hono's `<Suspense>` calls
 * `finally` on the promise it waits for and drops the result, which rejects
 * along with `data`: an unhandled rejection for every load that fails,
 * though the error boundary shows it.
 */
function quiet({ data }: QuietInput): Promise<unknown> {
  const promise = data.then();
  promise.finally = (onFinally) => {
    const settled = Promise.prototype.finally.call(promise, onFinally);
    settled.catch(() => undefined);
    return settled;
  };
  return promise;
}

type TreeInput = { component: FC<Record<string, unknown>>; props: RenderProps; context: ClientRenderContext };

export function tree({ component, props, context }: TreeInput): Child {
  const data = "data" in props && props.data instanceof Promise ? { data: quiet({ data: props.data }) } : {};
  const node = jsx(Suspense, {
    fallback: nothing(),
    children: jsx(component, { ...props, ...data, children: childrenOf({ host: context.children }) }),
  });
  if (!context.error) return node;
  const errorComponent = componentOf({ module: context.error.module, context: { ...context, kind: "error" } });
  return jsx(ErrorBoundary, {
    fallbackRender: errorComponentOf({ errorComponent, context, handle: context.error.handle }),
    children: node,
  });
}

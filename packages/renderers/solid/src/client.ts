/**
 * The browser side of the Solid renderer: `render` and `hydrate` from
 * `solid-js/web`, with `children` as a function that renders the children
 * marker and hands it to the element. The instance handle is Solid's
 * dispose function.
 *
 * A droplet mounted with `data` still to come renders under `<Suspense>`
 * inside an `<ErrorBoundary>`, which shows `+error.tsx` in place of
 * whatever throws while rendering, a resource of `data` that rejected
 * included.
 */
import type {
  ClientRenderContext,
  ComponentModule,
  DropletChildrenHost,
  RenderProps,
} from "@dropletsjs/droplets";
import {
  createComponent,
  createSignal,
  ErrorBoundary,
  onCleanup,
  onMount,
  sharedConfig,
  Show,
  Suspense,
  type Component,
  type JSX,
} from "solid-js";
import { hydrate as solidHydrate, render as solidRender } from "solid-js/web";
import { ensureHydrationState } from "./client-setup.ts";

/** What `mount` and `hydrate` return: Solid's dispose function. */
type Handle = () => void;

/** A fresh marker, as the server prints it. */
function createMarker(): HTMLElement {
  const marker = document.createElement("div");
  marker.setAttribute("data-droplet-children", "");
  marker.style.display = "contents";
  return marker;
}

/**
 * The `children` value: a function Solid calls where the component inserts
 * it, inside a render effect, so `onMount` and `onCleanup` have an owner.
 * It renders the marker, filled by the element once it is in the DOM and
 * emptied before it goes away: Solid runs an owner's cleanups before it
 * recomputes (`<Show>`, a ternary) and removes the old nodes after, so
 * `empty` sees a connected marker.
 *
 * When hydrating, `adopt` hands out the markers the server rendered, in
 * document order: Solid's `insert` keeps a node that is already in place, so
 * nothing is re-created or moved. When mounting, or once they are used up,
 * a fresh marker is created.
 */
function childrenOf(host: DropletChildrenHost, adopt: () => Element | undefined): () => JSX.Element {
  return () => {
    const marker = adopt() ?? createMarker();
    onMount(() => host.fill(marker));
    onCleanup(() => host.empty(marker));
    return marker;
  };
}

function componentOf(module: ComponentModule, context: ClientRenderContext): Component<Record<string, unknown>> {
  const component = module.default;
  if (typeof component !== "function") {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a Solid component`);
  }
  return component as Component<Record<string, unknown>>;
}

/**
 * What was thrown: Solid's boundary hands over anything that is not an
 * `Error` wrapped in one, `new Error("Unknown error", { cause })` (or the
 * string as message), and `handleError` must see it as it was.
 */
function thrown(caught: unknown): unknown {
  if (!(caught instanceof Error) || caught.constructor !== Error || !("cause" in caught)) return caught;
  const cause = caught.cause;
  if (cause instanceof Error) return caught;
  return caught.message === "Unknown error" || caught.message === cause ? cause : caught;
}

/**
 * The error boundary of a mounted droplet: what throws while rendering
 * goes through `handle` (the droplet's `handleError`) into the error page,
 * rendered in its place; nothing while `handle` runs, or when it rejects.
 */
function withBoundary(
  render: () => JSX.Element,
  error: NonNullable<ClientRenderContext["error"]>,
  children: () => JSX.Element,
  context: ClientRenderContext,
): () => JSX.Element {
  const page = componentOf(error.module, { ...context, kind: "error" });
  return () =>
    createComponent(ErrorBoundary, {
      fallback: (caught: unknown) => {
        const [shown, setShown] = createSignal<{ error: unknown }>();
        error.handle(thrown(caught)).then((value) => setShown({ error: value }), () => undefined);
        return createComponent(Show, {
          get when() {
            return shown();
          },
          keyed: true,
          children: ((value: { error: unknown }) => createComponent(page, { error: value.error, children })) as (
            item: unknown,
          ) => JSX.Element,
        });
      },
      get children() {
        return createComponent(Suspense, {
          get children() {
            return render();
          },
        });
      },
    });
}

export function mount(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): unknown {
  const component = componentOf(module, context);
  const children = childrenOf(context.children, () => undefined);
  const render = () => createComponent(component, { ...props, children });
  return solidRender(context.error ? withBoundary(render, context.error, children, context) : render, target);
}

export function hydrate(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): unknown {
  const component = componentOf(module, context);
  const serverMarkers = context.markers();
  const children = childrenOf(context.children, () => serverMarkers.shift());

  // Solid marks hydration as done for the whole page on the first event
  // after a hydration, and every later `hydrate()` then falls back to a
  // plain render that replaces the server markup. Each droplet hydrates on
  // its own: start afresh, with the state the setup module defined.
  const state = ensureHydrationState();
  state.done = false;
  sharedConfig.done = false;

  try {
    return solidHydrate(() => createComponent(component, { ...props, children }), target, {
      renderId: context.renderId,
    });
  } finally {
    // Hydration is synchronous: whatever `children` renders from now on
    // (a conditional branch, a hot update) gets a fresh marker.
    serverMarkers.length = 0;
  }
}

export function unmount(instance: unknown): void {
  (instance as Handle)();
}

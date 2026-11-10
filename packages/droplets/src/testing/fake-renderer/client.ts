/**
 * The browser side of the fake renderer. `mount` writes the component's
 * HTML; `hydrate` keeps what the server rendered; both then call the
 * component's optional `attach(target, props)` for behaviour and hand the
 * children marker to the host. See `../index.ts`.
 *
 * A component is a function of its props, with no way to wait: `mount`
 * waits for a droplet's `data` first, as a template engine does, and when
 * it rejects renders the error page in its place (its error boundary).
 */
import type { ClientRenderContext, ComponentModule, RenderProps } from "../../renderer.ts";
import { MARKER, type FakeComponent } from "./server.ts";

type Instance = {
  target: HTMLElement;
  context: ClientRenderContext;
  marker: Element | null;
  cleanup: (() => void) | undefined;
};

function html(module: ComponentModule, props: RenderProps, context: ClientRenderContext): string {
  const component = module.default as FakeComponent | undefined;
  if (typeof component !== "function") {
    throw new Error(`${context.droplet}: a .fake.js ${context.kind} must export a default function`);
  }
  // The same URLs the server rendered.
  return component({ ...props, children: () => MARKER, actionUrl: context.actionUrl });
}

function attach(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): Instance {
  // When hydrating, the server's marker; when mounting, the one just written.
  const marker = context.markers()[0] ?? target.querySelector("[data-droplet-children]");
  if (marker) context.children.fill(marker);
  const attachFn = module["attach"];
  type Attach = (target: HTMLElement, props: RenderProps, context: ClientRenderContext) => (() => void) | undefined;
  const cleanup = typeof attachFn === "function" ? (attachFn as Attach)(target, props, context) : undefined;
  return { target, context, marker, cleanup };
}

/** What to render once a droplet's `data` settled: the droplet, its error page, or nothing. */
async function settled(
  module: ComponentModule,
  props: RenderProps,
  context: ClientRenderContext,
): Promise<{ module: ComponentModule; props: RenderProps } | null> {
  if (!("data" in props)) return { module, props };
  try {
    return { module, props: { ...props, data: await props.data } };
  } catch (error) {
    if (!context.error) throw error;
    try {
      return { module: context.error.module, props: { error: await context.error.handle(error) } };
    } catch {
      return null;
    }
  }
}

export async function mount(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): Promise<Instance> {
  const shown = await settled(module, props, context);
  if (!shown) return { target, context, marker: null, cleanup: undefined };
  const head = typeof shown.module["head"] === "string" ? shown.module["head"] : "";
  target.innerHTML = head + html(shown.module, shown.props, context);
  return attach(shown.module, target, shown.props, context);
}

export function hydrate(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): Instance {
  // No virtual DOM to reconcile: the server markup stays as it is.
  return attach(module, target, props, context);
}

export function unmount(instance: unknown): void {
  const { cleanup, marker, context, target } = instance as Instance;
  cleanup?.();
  // The container out while the marker is still in the DOM, then the HTML goes.
  if (marker) context.children.empty(marker);
  target.replaceChildren();
}

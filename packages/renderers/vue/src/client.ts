/**
 * The browser side of the Vue renderer: `createSSRApp().mount()` hydrates,
 * `createApp().mount()` mounts, `app.unmount()` tears down. The instance
 * handle is the app. `DropletChildren` receives the element's children host
 * through app-level `provide`.
 *
 * The component renders under `<Suspense>`, so `await data` in
 * `<script setup>` works: when hydrating the value is there at once, and
 * Suspense adds nothing to the server's markup. A droplet mounted with
 * `data` still to come also gets an error boundary (`onErrorCaptured`),
 * which shows `+error.vue` in place of whatever throws while rendering, a
 * rejected `await data` included.
 */
import type {
  ClientRenderContext,
  ComponentModule,
  RenderProps,
} from "@dropletsjs/droplets";
import {
  createApp,
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  onErrorCaptured,
  shallowRef,
  Suspense,
  type App,
  type Component,
  type ComponentInternalInstance,
  type ShallowRef,
  type VNode,
} from "vue";
import { CHILDREN_KEY } from "./children.ts";

type WithStyles = { styles?: string[] };

const STYLE_MARK = "data-droplets-vue";

function componentOf(module: ComponentModule, context: ClientRenderContext): Component {
  const component = module.default;
  if (!component || (typeof component !== "object" && typeof component !== "function")) {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a Vue component`);
  }
  return component as Component;
}

/** Appends `css` to the document head, once per text. */
function injectStyle(css: string): void {
  const existing = Array.from(document.head.querySelectorAll(`style[${STYLE_MARK}]`));
  if (existing.some((style) => style.textContent === css)) return;
  const style = document.createElement("style");
  style.setAttribute(STYLE_MARK, "");
  style.textContent = css;
  document.head.appendChild(style);
}

/**
 * The `<style>` elements the server put before an error page's markup (its
 * `head`) move to the document head: Vue's hydration walks the target's
 * children from the first one and would take them for a mismatch.
 */
function adoptHead(target: HTMLElement): void {
  for (const style of Array.from(target.querySelectorAll(":scope > style"))) {
    style.remove();
    injectStyle(style.textContent ?? "");
  }
}

/** An error page mounted in the browser brings its own CSS, like on the server. */
function injectComponentStyles(component: Component, context: ClientRenderContext): void {
  if (context.kind !== "error") return;
  const styles = (component as WithStyles).styles;
  if (Array.isArray(styles)) for (const css of styles) injectStyle(css);
}

/** Each app's root props, which `update` changes, and the component's instance once mounted. */
type Live = { props: ShallowRef<RenderProps>; instance?: ComponentInternalInstance | null };
const live = new WeakMap<App, Live>();

/** The component under `<Suspense>`, as the root of the app, with props that `update` can change. */
function suspended(component: Component, state: Live): Component {
  const mounted = (vnode: VNode) => (state.instance = vnode.component);
  return defineComponent({
    name: "DropletRoot",
    setup: () => () =>
      h(Suspense, null, {
        default: () => h(component, { ...(state.props.value as Record<string, unknown>), onVnodeMounted: mounted }),
      }),
  });
}

/**
 * The error boundary of a mounted droplet: what throws while rendering
 * goes through `handle` (the droplet's `handleError`) into the error page,
 * rendered in its place; nothing while `handle` runs, or when it rejects.
 */
function withBoundary(root: Component, error: NonNullable<ClientRenderContext["error"]>, errorComponent: Component): Component {
  return defineComponent({
    name: "DropletBoundary",
    setup() {
      const failed = shallowRef(false);
      const shown = shallowRef<{ error: unknown }>();
      onErrorCaptured((caught) => {
        if (failed.value) return false;
        failed.value = true;
        error.handle(caught).then((value) => (shown.value = { error: value }), () => undefined);
        return false;
      });
      return () => {
        if (!failed.value) return h(root);
        return shown.value ? h(errorComponent, { error: shown.value.error }) : null;
      };
    },
  });
}

export function mount(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): App {
  const component = componentOf(module, context);
  injectComponentStyles(component, context);
  const current: Live = { props: shallowRef(props) };
  let root = suspended(component, current);
  if (context.error) {
    const errorContext = { ...context, kind: "error" as const };
    const errorComponent = componentOf(context.error.module, errorContext);
    injectComponentStyles(errorComponent, errorContext);
    root = withBoundary(root, context.error, errorComponent);
  }
  const app = createApp(root);
  app.provide(CHILDREN_KEY, context.children);
  app.mount(target);
  live.set(app, current);
  return app;
}

export function hydrate(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): App {
  const component = componentOf(module, context);
  // Vue compares the DOM with its virtual tree; the element took the host's
  // container out of the server-rendered marker before this call, and it
  // returns through `fill` once `DropletChildren` is mounted.
  adoptHead(target);
  injectComponentStyles(component, context);
  const current: Live = { props: shallowRef(props) };
  const app = createSSRApp(suspended(component, current));
  app.provide(CHILDREN_KEY, context.children);
  app.mount(target);
  live.set(app, current);
  return app;
}

/** New props for the root's component: Vue patches it, and its state stays. */
export async function update(instance: unknown, props: RenderProps): Promise<boolean> {
  const state = live.get(instance as App);
  if (!state) return false;
  // An async `setup` (`await props.data`) ran once, with the old data, and
  // never runs again for the same instance: the droplet remounts instead.
  // (`asyncDep` is Vue's own field for it, internal to its types.)
  if ((state.instance as { asyncDep?: unknown } | null | undefined)?.asyncDep) return false;
  state.props.value = props;
  await nextTick();
  return true;
}

export function unmount(instance: unknown): void {
  (instance as App).unmount();
}

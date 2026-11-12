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
import type { ClientRenderContext, ComponentModule, RenderProps } from "@dropletsjs/droplets";
import { type App, type Component, createApp, createSSRApp, defineComponent, h, onErrorCaptured, shallowRef } from "vue";
import { CHILDREN_KEY } from "./children.ts";
import { type Live, liveStates, suspended } from "./live-props.ts";

type WithStyles = { styles?: string[] };

type ComponentOfInput = { module: ComponentModule; context: Pick<ClientRenderContext, "droplet" | "kind"> };

/** The CSS texts one instance uses: counted once per instance, however many times it meets each. */
type Injected = Set<string>;

type InjectStyleInput = { css: string; injected: Injected };

type AdoptHeadInput = { target: HTMLElement; injected: Injected };

type InjectComponentStylesInput = { component: Component; context: Pick<ClientRenderContext, "kind">; injected: Injected };

type ReleaseStylesInput = { injected: Injected };

type WithBoundaryInput = { root: Component; error: NonNullable<ClientRenderContext["error"]>; errorComponent: Component };

/**
 * On each injected `<style>`, with the number of mounted instances that use
 * it as the value: in the DOM, so two copies of this module on one page
 * (two droplets servers with Vue) share the count.
 */
const STYLE_MARK = "data-droplet-vue";

/** What each mounted instance injected, released when it unmounts. */
const injectedStyles = new WeakMap<App, Injected>();

function componentOf({ module, context }: ComponentOfInput): Component {
  const component = module.default;
  if (!component || (typeof component !== "object" && typeof component !== "function")) {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a Vue component`);
  }
  return component as Component;
}

function styleFor(css: string): HTMLStyleElement | undefined {
  return Array.from(document.head.querySelectorAll<HTMLStyleElement>(`style[${STYLE_MARK}]`)).find((style) => style.textContent === css);
}

/** `css` in the document head, one `<style>` per text, counted for this instance. */
function injectStyle({ css, injected }: InjectStyleInput): void {
  if (injected.has(css)) return;
  injected.add(css);
  const existing = styleFor(css);
  if (existing) {
    existing.setAttribute(STYLE_MARK, String(Number(existing.getAttribute(STYLE_MARK)) + 1));
    return;
  }
  const style = document.createElement("style");
  style.setAttribute(STYLE_MARK, "1");
  style.textContent = css;
  document.head.appendChild(style);
}

/** The instance's styles let go: a `<style>` no mounted instance uses any more leaves the head. */
function releaseStyles({ injected }: ReleaseStylesInput): void {
  for (const css of injected) {
    const style = styleFor(css);
    if (!style) continue;
    const users = Number(style.getAttribute(STYLE_MARK)) - 1;
    if (users > 0) style.setAttribute(STYLE_MARK, String(users));
    else style.remove();
  }
}

/**
 * The `<style>` elements the server put before an error page's markup (its
 * `head`) move to the document head: Vue's hydration walks the target's
 * children from the first one and would take them for a mismatch.
 */
function adoptHead({ target, injected }: AdoptHeadInput): void {
  for (const style of Array.from(target.querySelectorAll(":scope > style"))) {
    style.remove();
    injectStyle({ css: style.textContent ?? "", injected });
  }
}

/** An error page mounted in the browser brings its own CSS, like on the server. */
function injectComponentStyles({ component, context, injected }: InjectComponentStylesInput): void {
  if (context.kind !== "error") return;
  const styles = (component as WithStyles).styles;
  if (Array.isArray(styles)) for (const css of styles) injectStyle({ css, injected });
}

/**
 * The error boundary of a mounted droplet: what throws while rendering
 * goes through `handle` (the droplet's `handleError`) into the error page,
 * rendered in its place; nothing while `handle` runs, or when it rejects.
 */
function withBoundary({ root, error, errorComponent }: WithBoundaryInput): Component {
  return defineComponent({
    name: "DropletBoundary",
    setup() {
      const failed = shallowRef(false);
      const shown = shallowRef<{ error: unknown }>();
      onErrorCaptured((caught) => {
        if (failed.value) return false;
        failed.value = true;
        error.handle(caught).then(
          (value) => (shown.value = { error: value }),
          // `handleError` rejected: the boundary shows nothing.
          () => undefined,
        );
        return false;
      });
      return () => {
        if (!failed.value) return h(root);
        return shown.value ? h(errorComponent, { error: shown.value.error }) : null;
      };
    },
  });
}

export function mount(module: ComponentModule, target: HTMLElement, props: RenderProps, context: ClientRenderContext): App {
  const component = componentOf({ module, context });
  const injected: Injected = new Set();
  injectComponentStyles({ component, context, injected });
  const state: Live = { props: shallowRef(props) };
  let root = suspended({ component, state });
  if (context.error) {
    const errorContext = { ...context, kind: "error" as const };
    const errorComponent = componentOf({ module: context.error.module, context: errorContext });
    injectComponentStyles({ component: errorComponent, context: errorContext, injected });
    root = withBoundary({ root, error: context.error, errorComponent });
  }
  const app = createApp(root);
  app.provide(CHILDREN_KEY, context.children);
  app.mount(target);
  liveStates.set(app, state);
  injectedStyles.set(app, injected);
  return app;
}

export function hydrate(module: ComponentModule, target: HTMLElement, props: RenderProps, context: ClientRenderContext): App {
  const component = componentOf({ module, context });
  const injected: Injected = new Set();
  // Vue compares the DOM with its virtual tree; the element took the host's
  // container out of the server-rendered marker before this call, and it
  // returns through `fill` once `DropletChildren` is mounted.
  adoptHead({ target, injected });
  injectComponentStyles({ component, context, injected });
  const state: Live = { props: shallowRef(props) };
  const app = createSSRApp(suspended({ component, state }));
  app.provide(CHILDREN_KEY, context.children);
  app.mount(target);
  liveStates.set(app, state);
  injectedStyles.set(app, injected);
  return app;
}

export function unmount(instance: unknown): void {
  const app = instance as App;
  app.unmount();
  const injected = injectedStyles.get(app);
  if (!injected) return;
  injectedStyles.delete(app);
  releaseStyles({ injected });
}

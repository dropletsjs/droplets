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

type InjectStyleInput = { css: string };

type AdoptHeadInput = { target: HTMLElement };

type InjectComponentStylesInput = { component: Component; context: Pick<ClientRenderContext, "kind"> };

type WithBoundaryInput = { root: Component; error: NonNullable<ClientRenderContext["error"]>; errorComponent: Component };

const STYLE_MARK = "data-droplets-vue";

function componentOf({ module, context }: ComponentOfInput): Component {
  const component = module.default;
  if (!component || (typeof component !== "object" && typeof component !== "function")) {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a Vue component`);
  }
  return component as Component;
}

/** Appends `css` to the document head, once per text. */
function injectStyle({ css }: InjectStyleInput): void {
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
function adoptHead({ target }: AdoptHeadInput): void {
  for (const style of Array.from(target.querySelectorAll(":scope > style"))) {
    style.remove();
    injectStyle({ css: style.textContent ?? "" });
  }
}

/** An error page mounted in the browser brings its own CSS, like on the server. */
function injectComponentStyles({ component, context }: InjectComponentStylesInput): void {
  if (context.kind !== "error") return;
  const styles = (component as WithStyles).styles;
  if (Array.isArray(styles)) for (const css of styles) injectStyle({ css });
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
  injectComponentStyles({ component, context });
  const state: Live = { props: shallowRef(props) };
  let root = suspended({ component, state });
  if (context.error) {
    const errorContext = { ...context, kind: "error" as const };
    const errorComponent = componentOf({ module: context.error.module, context: errorContext });
    injectComponentStyles({ component: errorComponent, context: errorContext });
    root = withBoundary({ root, error: context.error, errorComponent });
  }
  const app = createApp(root);
  app.provide(CHILDREN_KEY, context.children);
  app.mount(target);
  liveStates.set(app, state);
  return app;
}

export function hydrate(module: ComponentModule, target: HTMLElement, props: RenderProps, context: ClientRenderContext): App {
  const component = componentOf({ module, context });
  // Vue compares the DOM with its virtual tree; the element took the host's
  // container out of the server-rendered marker before this call, and it
  // returns through `fill` once `DropletChildren` is mounted.
  adoptHead({ target });
  injectComponentStyles({ component, context });
  const state: Live = { props: shallowRef(props) };
  const app = createSSRApp(suspended({ component, state }));
  app.provide(CHILDREN_KEY, context.children);
  app.mount(target);
  liveStates.set(app, state);
  return app;
}

export function unmount(instance: unknown): void {
  (instance as App).unmount();
}

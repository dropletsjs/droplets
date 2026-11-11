/**
 * `@dropletsjs/renderer-vue`: the Vue 3 renderer.
 *
 * ```ts
 * // vite.config.ts
 * import { droplets } from "@dropletsjs/droplets/vite";
 * import { node } from "@dropletsjs/adapter-node";
 * import { vue } from "@dropletsjs/renderer-vue";
 *
 * export default defineConfig({ plugins: [droplets({ adapter: node(), renderers: [vue()] })] });
 * ```
 *
 * `+droplet.vue` and `+error.vue` are single-file components compiled by
 * `@vitejs/plugin-vue`. Flags come from a plain `<script>` block next to
 * `<script setup>`: `export const prerender = true` (both blocks must share
 * their `lang`). The component declares `data` (droplet) or `error` (error
 * page) with `defineProps`, and renders the host's content with
 * `<DropletChildren />` from `@dropletsjs/renderer-vue/children`.
 * Error pages compile in plugin-vue's custom-element mode, so their
 * `<style>` blocks are inlined and travel with their markup.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vuePlugin, { type Options } from "@vitejs/plugin-vue";
import type { DropletRenderer } from "@dropletsjs/droplets";

/** The props of `+droplet.vue`: `data` from the loads (a promise when mounted, the value when hydrated). For `defineProps<DropletProps<…>>()`. */
export type DropletProps<Data = unknown, Form = unknown> = {
  data: Data | Promise<Data>;
  /** After a form action, what it returned or `fail()`ed with; absent otherwise. */
  form?: Form;
};

/** The props of `+error.vue`: the error out of `handleError`. */
export type DropletErrorProps<Err = unknown> = { error: Err };

export type VueRendererOptions = {
  /**
   * Set to `false` to add `@vitejs/plugin-vue` to your Vite config yourself.
   * Give `+error.vue` files `features.customElement` so their styles are
   * inlined and travel with the markup.
   */
  plugin?: boolean;
  /**
   * Options merged into the ones this renderer passes to
   * `@vitejs/plugin-vue`: `features.customElement` is combined with the error
   * page pattern, the rest replaces the defaults.
   */
  vitePlugin?: Options;
};

// `src/` and `dist/` both sit directly under the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ERROR_COMPONENT = /[\\/]\+[Ee]rror\.vue$/;

type CustomElement = NonNullable<Options["features"]>["customElement"];

/** The error page pattern plus whatever the user matches. */
function withErrorComponents(user: CustomElement): CustomElement {
  if (user === undefined || user === false) return ERROR_COMPONENT;
  if (user === true) return true;
  return [ERROR_COMPONENT, ...(Array.isArray(user) ? user : [user])];
}

/** The Vue renderer, for `droplets({ renderers: [vue()] })`. */
export function vue(options: VueRendererOptions = {}): DropletRenderer {
  const user = options.vitePlugin ?? {};
  const pluginOptions: Options = {
    ...user,
    features: {
      ...user.features,
      // Error pages carry their own CSS: on the server inside the markup, in
      // the browser injected when mounted, since a failed droplet's
      // stylesheet may not be the one they need. Custom-element mode is how
      // plugin-vue inlines a component's styles (`styles` on the component).
      customElement: withErrorComponents(user.features?.customElement ?? user.customElement),
    },
  };
  delete pluginOptions.customElement;

  return {
    name: "vue",
    extensions: [".vue"],
    packages: ["vue", "@dropletsjs/renderer-vue"],
    componentTypes: "@dropletsjs/renderer-vue",
    ...(options.plugin === false ? {} : { plugins: [vuePlugin(pluginOptions)] }),
    server: resolve(packageRoot, "dist/server.js"),
    client: resolve(packageRoot, "dist/client.js"),
  };
}

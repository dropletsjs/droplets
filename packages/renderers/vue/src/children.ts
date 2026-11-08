/**
 * `@dropletsjs/renderer-vue/children`: the component a droplet uses
 * where it wants the host's content.
 *
 * ```vue
 * <script setup lang="ts">
 * import { DropletChildren } from "@dropletsjs/renderer-vue/children";
 * </script>
 *
 * <template>
 *   <section><DropletChildren /></section>
 * </template>
 * ```
 *
 * It renders the children marker, `<div data-app-children style="display: contents">`,
 * on the server and in the browser, where it tells the element to fill it
 * once mounted and to empty it in `onBeforeUnmount`, which Vue runs before
 * it removes the DOM. The element's callbacks reach it through app-level
 * `provide`, so nothing has to be passed down as props.
 *
 * This entry is browser-safe: it only imports `vue`.
 */
import type { DropletChildrenHost } from "@dropletsjs/droplets";
import { defineComponent, h, inject, onBeforeUnmount, onMounted, ref, type InjectionKey } from "vue";

/**
 * The injection key the renderer provides the element's children host under:
 * `null` on the server, where there is nothing to fill.
 */
export const CHILDREN_KEY: InjectionKey<DropletChildrenHost | null> = Symbol.for("droplets:vue:children");

/** Renders the children marker. See the module documentation. */
export const DropletChildren = defineComponent({
  name: "DropletChildren",
  // Attributes have nowhere to go: the root is a fragment, so the marker is
  // not a component root and never inherits the parent's scoped-style
  // attribute (`data-v-…`), keeping the marker as the contract has it.
  inheritAttrs: false,
  setup() {
    const host = inject(CHILDREN_KEY, null);
    const marker = ref<HTMLElement | null>(null);
    onMounted(() => {
      if (host && marker.value) host.fill(marker.value);
    });
    // Before Vue removes the DOM: the container leaves a connected marker.
    onBeforeUnmount(() => {
      if (host && marker.value) host.empty(marker.value);
    });
    return () => [h("div", { "data-app-children": "", style: "display: contents", ref: marker })];
  },
});

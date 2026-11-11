/** A Vue droplet's root with props that can change, for `client.ts` and `client-dev.ts`. */
import type { RenderProps } from "@dropletsjs/droplets";
import { defineComponent, h, Suspense, type App, type Component, type ComponentInternalInstance, type ShallowRef, type VNode } from "vue";

/** Each app's root props, which `update` changes in dev, and the component's instance once mounted. */
export type Live = { props: ShallowRef<RenderProps>; instance?: ComponentInternalInstance | null };
export const live = new WeakMap<App, Live>();

/** The component under `<Suspense>`, as the root of the app, with props that `update` can change. */
export function suspended(component: Component, state: Live): Component {
  const mounted = (vnode: VNode) => (state.instance = vnode.component);
  return defineComponent({
    name: "DropletRoot",
    setup: () => () =>
      h(Suspense, null, {
        default: () => h(component, { ...(state.props.value as Record<string, unknown>), onVnodeMounted: mounted }),
      }),
  });
}

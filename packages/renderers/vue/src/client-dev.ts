/** The renderer's `clientDev` module: what `vite dev` needs and a production build leaves out. */
import type { RenderProps } from "@dropletsjs/droplets";
import { nextTick, type App } from "vue";
import { live } from "./live-props.ts";

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

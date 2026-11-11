/** The renderer's `clientDev` module: what `vite dev` needs and a production build leaves out. */
import type { RenderProps } from "@dropletsjs/droplets";
import { type App, nextTick } from "vue";
import { liveStates } from "./live-props.ts";

/** Vue's own field for a pending async `setup`, internal to its types. */
type WithAsyncDep = { asyncDep?: unknown };

/** New props for the root's component: Vue patches it, and its state stays. */
export async function update(instance: unknown, props: RenderProps): Promise<boolean> {
  const state = liveStates.get(instance as App);
  if (!state) return false;
  // An async `setup` (`await props.data`) ran once, with the old data, and
  // never runs again for the same instance: the droplet remounts instead.
  if ((state.instance as WithAsyncDep | null | undefined)?.asyncDep) return false;
  state.props.value = props;
  await nextTick();
  return true;
}

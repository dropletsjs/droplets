/** The renderer's `clientDev` module: what `vite dev` needs and a production build leaves out. */
import type { RenderProps } from "@dropletsjs/droplets";
import { setters, type Handle } from "./live-props.ts";

/** New props through the signal the component reads them from: no new instance, its state stays. */
export function update(instance: unknown, props: RenderProps): boolean {
  const set = setters.get(instance as Handle);
  if (!set) return false;
  set(props);
  return true;
}

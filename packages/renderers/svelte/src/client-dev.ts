/** The renderer's `clientDev` module: what `vite dev` needs and a production build leaves out. */
import type { RenderProps } from "@dropletsjs/droplets";
import { asyncMode } from "virtual:droplets-renderer-svelte/options";
import { setters } from "./live-props.ts";

/**
 * New `data` (and `form`) for a live droplet: its props change in place,
 * and the component keeps its state. Without async mode the component
 * never waits for `data`: it gets the value, as when it mounted.
 */
export async function update(instance: unknown, props: RenderProps): Promise<boolean> {
  const set = instance && typeof instance === "object" ? setters.get(instance) : undefined;
  if (!set) return false;
  set(!asyncMode && "data" in props ? { ...props, data: await props.data } : props);
  return true;
}

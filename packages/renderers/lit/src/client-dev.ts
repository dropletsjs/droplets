/** The renderer's `clientDev` module: what `vite dev` needs and a production build leaves out. */
import type { RenderProps } from "@dropletsjs/droplets";
import { render } from "lit";
import type { Instance, LitContainer } from "./client.ts";
import { hostTemplate } from "./template.ts";

/**
 * The host template again with new props, into the same container: Lit
 * updates the element's properties, and the element, with its state,
 * stays. `data` is the value, as on mount.
 */
export async function update(instance: unknown, props: RenderProps): Promise<boolean> {
  const { target, tag, actionUrl } = instance as Instance;
  if (!tag || !actionUrl || !(target as LitContainer)._$litPart$) return false;
  const next = "data" in props ? { ...props, data: await props.data } : props;
  render(hostTemplate(tag, next, actionUrl), target);
  return true;
}

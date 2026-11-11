/** The renderer's `clientDev` module: what `vite dev` needs and a production build leaves out. */
import type { RenderProps } from "@dropletsjs/droplets";
import { render as preactRender } from "preact";
import type { PreactInstance } from "./client.ts";
import { isThenable, tree } from "./tree.ts";

/**
 * The same tree with new props, rendered into the same target: Preact
 * diffs it against what is there, and the component keeps its state.
 * `data` is always the value, as on mount.
 */
export async function update(instance: unknown, props: RenderProps): Promise<boolean> {
  const { target, component, context } = instance as PreactInstance;
  if (!component || !context) return false;
  const next = "data" in props && isThenable(props.data) ? { ...props, data: await props.data } : props;
  preactRender(tree(component, next, context), target);
  return true;
}

/** The renderer's `clientDev` module: what `vite dev` needs and a production build leaves out. */
import type { RenderProps } from "@dropletsjs/droplets";
import { flushSync } from "react-dom";
import type { ReactInstance } from "./client.ts";
import { tree } from "./tree.ts";

/** The same tree with new props: React reconciles it, and the component keeps its state. */
export function update(instance: unknown, props: RenderProps): boolean {
  const { root, component, context } = instance as ReactInstance;
  flushSync(() => root.render(tree({ component, props, context })));
  return true;
}

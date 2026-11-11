/** The renderer's `clientDev` module: what `vite dev` needs and a production build leaves out. */
import type { RenderProps } from "@dropletsjs/droplets";
import { markersIn, type Instance } from "./client.ts";
import { templateOf } from "./runtime.ts";

/**
 * The template again with new data, in place of its markup: a template
 * has no state to keep. The host's container leaves its marker first and
 * goes into the new one.
 */
export async function update(instance: unknown, props: RenderProps): Promise<boolean> {
  const handle = instance as Instance;
  if (!handle.module || !("data" in props)) return false;
  const data = await props.data;
  const { target, context } = handle;
  for (const marker of handle.markers) context.children.empty(marker);
  target.innerHTML = templateOf(handle.module, context)(
    { ...props, data },
    {
      data: { droplet: context.droplet, kind: context.kind, renderId: context.renderId, actionUrl: context.actionUrl },
    },
  );
  handle.markers = markersIn(target);
  for (const marker of handle.markers) context.children.fill(marker);
  return true;
}

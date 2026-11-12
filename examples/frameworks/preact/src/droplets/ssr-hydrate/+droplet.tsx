/** @jsxImportSource preact */
import { Card } from "../../lib/Card.tsx";
// Generated from this folder's files: `data` is what `load` in +droplet.ts returns.
import type { DropletProps } from "./$types";

export const ssr = true;
export const hydrate = true;

export default function PreactSsrHydrate({ data }: DropletProps) {
  // Always the value: the one the server rendered with when hydrating; when
  // the element mounts it fresh, the renderer awaits the load first.
  return <Card mode="ssr-hydrate" data={data} />;
}

import { createResource } from "solid-js";
import { Card } from "../../lib/Card.tsx";
// Generated from this folder's files: `data` is what `load` in +droplet.ts returns.
import type { DropletProps } from "./$types";

export const ssr = true;
export const hydrate = false;

export default function SolidSsrNoHydrate(props: DropletProps) {
  // Server HTML only: the value the loads returned (the resource branch is for the type alone).
  const data = props.data;
  const facts = data instanceof Promise ? createResource(() => data)[0] : () => data;
  return <Card mode="ssr-nohydrate" data={facts()} />;
}

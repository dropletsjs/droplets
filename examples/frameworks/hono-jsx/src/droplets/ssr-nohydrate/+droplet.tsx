import { use } from "hono/jsx";
import { Card } from "../../lib/Card.tsx";
// Generated from this folder's files: `data` is what `load` in +droplet.ts returns.
import type { DropletProps } from "./$types";

export const ssr = true;
export const hydrate = false;

export default function HonoSsrNoHydrate({ data }: DropletProps) {
  // Server HTML only: the value the loads returned (the promise branch is for the type alone).
  const facts = data instanceof Promise ? use(data) : data;
  return <Card mode="ssr-nohydrate" data={facts} />;
}

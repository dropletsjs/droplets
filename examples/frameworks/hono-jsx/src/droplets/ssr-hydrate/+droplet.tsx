import { use } from "hono/jsx";
import { Card } from "../../lib/Card.tsx";
// Generated from this folder's files: `data` is what `load` in +droplet.ts returns.
import type { DropletProps } from "./$types";

export const ssr = true;
export const hydrate = true;

export default function HonoSsrHydrate({ data }: DropletProps) {
  // The value the server rendered with when hydrating; a promise when the
  // element mounts it fresh: `use` suspends on it.
  const facts = data instanceof Promise ? use(data) : data;
  return <Card mode="ssr-hydrate" data={facts} />;
}

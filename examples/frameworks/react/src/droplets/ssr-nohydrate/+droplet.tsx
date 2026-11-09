import { use } from "react";
import { Card } from "../../lib/Card.tsx";
// Generated from this folder's files: `data` is what the server load returns.
import type { DropletProps } from "./$types";

export const ssr = true;
export const hydrate = false;

export default function ReactSsrNoHydrate({ data }: DropletProps) {
  // The value the server rendered with when hydrating; a promise when the
  // element mounts it fresh: `use` suspends on it.
  const facts = data instanceof Promise ? use(data) : data;
  return <Card mode="ssr-nohydrate" data={facts} />;
}

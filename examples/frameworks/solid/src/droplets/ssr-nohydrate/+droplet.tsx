/** @jsxImportSource solid-js */
import { createResource } from "solid-js";
import { Card } from "../../lib/Card.tsx";
// Generated from this folder's files: `data` is what the server load returns.
import type { DropletProps } from "./$types";

export const ssr = true;
export const hydrate = false;

export default function SolidSsrNoHydrate(props: DropletProps) {
  // The value the server rendered with when hydrating; a promise when the
  // element mounts it fresh: a resource of it suspends.
  const data = props.data;
  const facts = data instanceof Promise ? createResource(() => data)[0] : () => data;
  return <Card mode="ssr-nohydrate" data={facts()} />;
}

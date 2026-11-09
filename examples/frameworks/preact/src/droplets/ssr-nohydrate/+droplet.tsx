/** @jsxImportSource preact */
import { Card } from "../../lib/Card.tsx";
// Generated from this folder's files: `data` is what the server load returns.
import type { DropletProps } from "./$types";

export const ssr = true;
export const hydrate = false;

export default function PreactSsrNoHydrate({ data }: DropletProps) {
  // Server HTML only: the value the server load returned.
  return <Card mode="ssr-nohydrate" data={data} />;
}

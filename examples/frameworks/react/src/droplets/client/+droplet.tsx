/** @jsxImportSource react */
import { Card } from "../../lib/Card.tsx";
import type { DropletProps } from "./$types";

// Nothing on the server: the element mounts it in the browser, and the
// card fetches what it shows from /api.
export const ssr = false;
export const hydrate = true;

export default function ReactClient(_: DropletProps) {
  return <Card mode="client" />;
}

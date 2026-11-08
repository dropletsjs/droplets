import type { DropletProps } from "@dropletsjs/renderer-solid";

// Client-only: the server leaves an empty element and the browser mounts.
export const ssr = false;

export default function Frame(props: DropletProps) {
  return <div data-testid="frame">{props.children}</div>;
}

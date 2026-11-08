import type { DropletProps } from "@dropletsjs/renderer-hono-jsx";

// Client-only: the server leaves an empty element and the browser mounts.
export const ssr = false;

export default function Frame({ children }: DropletProps) {
  return <div data-testid="frame">{children}</div>;
}

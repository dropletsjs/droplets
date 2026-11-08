import { useState } from "preact/hooks";
import type { DropletProps } from "@dropletsjs/renderer-preact";

export const ssr = true;
export const hydrate = true;

export default function Hello({ data, children }: DropletProps<{ greeting: string }>) {
  const [clicks, setClicks] = useState(0);
  // Always the value: when the element mounts it fresh, the renderer awaits
  // the data first, and a rejection shows the error page instead.
  return (
    <section>
      <h1 data-testid="greeting">{data.greeting}</h1>
      <button data-testid="count" onClick={() => setClicks((n) => n + 1)}>
        {clicks}
      </button>
      <div data-testid="children">{children}</div>
    </section>
  );
}

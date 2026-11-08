import { use, useState } from "react";
import type { DropletProps } from "@dropletsjs/renderer-react";

export const ssr = true;
export const hydrate = true;

export default function Hello({ data, children }: DropletProps<{ greeting: string }>) {
  const [clicks, setClicks] = useState(0);
  // The value when hydrating, a promise when mounted from scratch: `use`
  // suspends on it, and a rejection reaches the error boundary.
  const { greeting } = data instanceof Promise ? use(data) : data;
  return (
    <section>
      <h1 data-testid="greeting">{greeting}</h1>
      <button data-testid="count" onClick={() => setClicks((n) => n + 1)}>
        {clicks}
      </button>
      <div data-testid="children">{children}</div>
    </section>
  );
}

/** @jsxImportSource react */
import { use, useEffect, useState } from "react";
import type { DropletProps } from "./$types";

// Rendered on the server, then hydrated: the buttons work only once the
// bundle has run. No +droplet.server.ts, so the browser asks the server for
// nothing but the bundle.
export const ssr = true;
export const hydrate = true;

export default function Counter({ data }: DropletProps) {
  const { start } = data instanceof Promise ? use(data) : data;
  const [count, setCount] = useState(start);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return (
    <section className="demo-card" data-hydrated={hydrated}>
      <p className="demo-row">
        <span className="demo-tag">counter · React</span>
      </p>
      <p className="demo-row">
        <button type="button" className="demo-button secondary" aria-label="Decrease" onClick={() => setCount((n) => n - 1)}>
          −
        </button>
        <output className="demo-title" aria-live="polite" data-count>
          {count}
        </output>
        <button type="button" className="demo-button" aria-label="Increase" onClick={() => setCount((n) => n + 1)}>
          +
        </button>
        <button type="button" className="demo-button secondary" onClick={() => setCount(start)}>
          Reset
        </button>
      </p>
      <p className="demo-muted">
        {hydrated ? "Hydrated: the count lives in this tab only." : "Server HTML: the buttons wake up once React hydrates."}
      </p>
    </section>
  );
}

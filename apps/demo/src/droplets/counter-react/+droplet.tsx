/** @jsxImportSource react */
import { use, useEffect, useState } from "react";
import type { DropletProps } from "./$types";

export const ssr = true;
export const hydrate = true;

export default function Counter({ data }: DropletProps) {
  // What the server load returned. A value when hydrating, a promise when
  // the element mounts it fresh: `use` suspends on it.
  const { framework, start } = data instanceof Promise ? use(data) : data;
  const [added, setAdded] = useState(0);
  // False in the server's HTML; true once this component runs in the browser.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return (
    <section className="demo-card" data-hydrated={String(hydrated)}>
      <p className="demo-row">
        <span className="demo-tag">counter · {framework}</span>
      </p>
      <p className="demo-row">
        <output className="demo-title" aria-live="polite">
          {start + added}
        </output>
        <button type="button" className="demo-button" onClick={() => setAdded((n) => n + 1)}>
          Add one
        </button>
      </p>
      <p className="demo-muted">
        {hydrated ? `Hydrated: ${framework} runs the button in this tab.` : `Server HTML: the button works once ${framework} hydrates.`}
      </p>
    </section>
  );
}

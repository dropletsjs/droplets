/** @jsxImportSource preact */
import { useEffect, useState } from "preact/hooks";
import type { DropletProps } from "./$types";

export const ssr = true;
export const hydrate = true;

export default function Counter({ data }: DropletProps) {
  // What the server load returned. Always the value: Preact has no
  // use(promise), so the renderer waits for it before rendering.
  const { framework, start } = data;
  const [added, setAdded] = useState(0);
  // False in the server's HTML; true once this component runs in the browser.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return (
    <section class="demo-card" data-hydrated={String(hydrated)}>
      <p class="demo-row">
        <span class="demo-tag">counter · {framework}</span>
      </p>
      <p class="demo-row">
        <output class="demo-title" aria-live="polite">
          {start + added}
        </output>
        <button type="button" class="demo-button" onClick={() => setAdded((n) => n + 1)}>
          Add one
        </button>
      </p>
      <p class="demo-muted">
        {hydrated ? `Hydrated: ${framework} runs the button in this tab.` : `Server HTML: the button works once ${framework} hydrates.`}
      </p>
    </section>
  );
}

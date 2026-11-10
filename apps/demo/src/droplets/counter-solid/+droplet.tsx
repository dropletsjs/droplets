/** @jsxImportSource solid-js */
import { createResource, createSignal, onMount } from "solid-js";
import type { DropletProps } from "./$types";

export const ssr = true;
export const hydrate = true;

export default function Counter(props: DropletProps) {
  // What the server load returned. A value when hydrating, a promise when
  // the element mounts it fresh: a resource of it suspends.
  const data = props.data;
  const value = data instanceof Promise ? createResource(() => data)[0] : () => data;
  const [added, setAdded] = createSignal(0);
  // False in the server's HTML; true once this component runs in the browser.
  const [hydrated, setHydrated] = createSignal(false);
  onMount(() => setHydrated(true));
  const framework = () => value()?.framework;

  return (
    <section class="demo-card" data-hydrated={String(hydrated())}>
      <p class="demo-row">
        <span class="demo-tag">counter · {framework()}</span>
      </p>
      <p class="demo-row">
        <output class="demo-title" aria-live="polite">
          {(value()?.start ?? 0) + added()}
        </output>
        <button type="button" class="demo-button" onClick={() => setAdded((n) => n + 1)}>
          Add one
        </button>
      </p>
      <p class="demo-muted">
        {hydrated() ? `Hydrated: ${framework()} runs the button in this tab.` : `Server HTML: the button works once ${framework()} hydrates.`}
      </p>
    </section>
  );
}

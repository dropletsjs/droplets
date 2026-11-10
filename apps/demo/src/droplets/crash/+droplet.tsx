/** @jsxImportSource solid-js */
import { createResource, createSignal, onMount } from "solid-js";
import type { DropletProps } from "./$types";

export const ssr = true;
export const hydrate = true;

export default function Crash(props: DropletProps) {
  // The value the server rendered with when hydrating; a promise when the
  // element mounts it fresh: a resource of it suspends.
  const data = props.data;
  const value = data instanceof Promise ? createResource(() => data)[0] : () => data;
  const [hydrated, setHydrated] = createSignal(false);
  onMount(() => setHydrated(true));

  return (
    <section class="demo-card" data-hydrated={hydrated()}>
      <p class="demo-row">
        <span class="demo-tag">crash · Solid</span>
      </p>
      <p class="demo-title">All fine: the load did not throw.</p>
      <p class="demo-muted">
        Rendered at <time datetime={value()?.renderedAt}>{value()?.renderedAt.slice(0, 19).replace("T", " ")} UTC</time>. With
        {" "}<code>fail</code> set, the load throws and the error page takes this place.
      </p>
    </section>
  );
}

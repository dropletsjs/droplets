/** @jsxImportSource solid-js */
// `error` is what handleError in +droplet.server.ts returns.
import { createSignal, onMount } from "solid-js";
import type { DropletErrorProps } from "./$types";

export default function CrashError(props: DropletErrorProps) {
  const [hydrated, setHydrated] = createSignal(false);
  onMount(() => setHydrated(true));
  return (
    <section class="demo-card" data-hydrated={hydrated()} data-error-page>
      <p class="demo-row">
        <span class="demo-tag">crash · Solid · +error.tsx</span>
      </p>
      <p class="demo-error" role="alert">
        {props.error.message}
      </p>
    </section>
  );
}

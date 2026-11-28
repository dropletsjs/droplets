<script module lang="ts">
  export const ssr = true;
  export const hydrate = true;
</script>

<script lang="ts">
  import type { DropletProps } from "@dropletsjs/renderer-svelte";

  let { data, children }: DropletProps<{ greeting: string; kinds: string }> = $props();
  let clicks = $state(0);
</script>

<section>
  <!-- The value when hydrating, a promise when mounted from scratch: a
       rejection reaches the renderer's boundary. -->
  <h1 data-testid="greeting">{(await data).greeting}</h1>
  <p data-testid="kinds">{(await data).kinds}</p>
  <button data-testid="count" onclick={() => (clicks += 1)}>{clicks}</button>
  <div data-testid="children">{@render children?.()}</div>
</section>

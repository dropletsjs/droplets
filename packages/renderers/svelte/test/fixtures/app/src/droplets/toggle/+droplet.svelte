<script lang="ts">
  import type { DropletProps } from "@dropletsjs/renderer-svelte";

  // Not part of the conformance scenarios: an `if` around the host's
  // children, for the browser check of the hide/show contract.
  let { children }: DropletProps = $props();
  let open = $state(true);
</script>

<section data-testid="toggle">
  <button data-testid="toggle-button" onclick={() => (open = !open)}>{open ? "close" : "open"}</button>
  {#if open}<div data-testid="toggle-children">{@render children?.()}</div>{/if}
</section>

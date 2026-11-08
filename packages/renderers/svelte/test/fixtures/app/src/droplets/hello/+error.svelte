<script lang="ts">
  import type { DropletErrorProps } from "@dropletsjs/renderer-svelte";

  let { error, children }: DropletErrorProps<{ message: string }> = $props();
  let tries = $state(0);
</script>

<p class="oops" data-testid="error">{error.message}</p>
<button data-testid="retry" onclick={() => (tries += 1)}>{tries}</button>
<div data-testid="error-children">{@render children?.()}</div>

<style>
  /* Compiled with injected CSS: travels with the markup. */
  .oops { color: crimson; }
</style>

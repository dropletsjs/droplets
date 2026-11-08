<script module lang="ts">
  // Client-only: the server leaves an empty element and the browser mounts.
  export const ssr = false;
</script>

<script lang="ts">
  import type { DropletProps } from "@dropletsjs/renderer-svelte";

  let { children }: DropletProps = $props();
</script>

<div data-testid="frame">{@render children?.()}</div>

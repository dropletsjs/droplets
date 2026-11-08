<script lang="ts">
  import type { DropletErrorProps } from "@dropletsjs/renderer-svelte";

  let { error }: DropletErrorProps<{ message: string }> = $props();
</script>

<p data-testid="docs-error">{error.message}</p>

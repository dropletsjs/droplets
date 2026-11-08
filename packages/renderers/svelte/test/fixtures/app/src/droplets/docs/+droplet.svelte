<script module lang="ts">
  export const prerender = true;
</script>

<script lang="ts">
  import type { DropletProps } from "@dropletsjs/renderer-svelte";

  let { data }: DropletProps<{ page: number }> = $props();
</script>

<article data-testid="docs"><h1>Page {data.page}</h1><p>@HOST@</p></article>

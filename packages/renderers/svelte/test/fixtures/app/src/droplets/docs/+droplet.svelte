<script module lang="ts">
  export const prerender = true;
</script>

<script lang="ts">
  import type { DropletProps } from "@dropletsjs/renderer-svelte";

  let { data }: DropletProps<{ page: number }> = $props();
</script>

<article data-testid="docs">{#await data then { page }}<h1>Page {page}</h1>{/await}<p>@HOST@</p></article>

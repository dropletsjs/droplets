<script module lang="ts">
  // Server-rendered only: no JavaScript is built or served for it; its styles still are.
  export const ssr = true;
  export const hydrate = false;
</script>

<script lang="ts">
  import Card from "../../lib/Card.svelte";
  // Generated from this folder's files: `data` is what the server load returns.
  import type { DropletProps } from "./$types";

  let { data }: DropletProps = $props();
</script>

{#await data then facts}
  <Card mode="ssr-nohydrate" data={facts} />
{/await}

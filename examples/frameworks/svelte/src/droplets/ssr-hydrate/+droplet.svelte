<script module lang="ts">
  export const ssr = true;
  export const hydrate = true;
</script>

<script lang="ts">
  import Card from "../../lib/Card.svelte";
  // Generated from this folder's files: `data` is what `load` in +droplet.ts returns.
  import type { DropletProps } from "./$types";

  // The value the server rendered with when hydrating; a promise when the
  // element mounts it fresh (a host that wrote the element itself).
  let { data }: DropletProps = $props();
</script>

{#await data then facts}
  <Card mode="ssr-hydrate" data={facts} />
{/await}

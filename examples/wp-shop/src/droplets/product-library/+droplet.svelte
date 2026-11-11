<script module lang="ts">
  export const ssr = true;
  export const hydrate = true;
</script>

<script lang="ts">
  import { actionUrl } from "$droplets/form";
  import ProductLibrary from "../../lib/svelte/ProductLibrary.svelte";
  import type { DropletActions, DropletProps } from "./$types";

  let { data, form }: DropletProps = $props();
  const add = actionUrl<DropletActions>("add");
</script>

{#await data then value}
  <ProductLibrary data={value} {add} {form} />
{/await}

<script module lang="ts">
  // Server-rendered; the bundle loads when the card is about to scroll into
  // view. The card is the library's own component.
  export const ssr = true;
  export const hydrate = "visible";
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { actionUrl } from "$droplets/form";
  import ProductCard from "../../lib/svelte/ProductCard.svelte";
  import { checkStock } from "../../lib/api.ts";
  import { isRecord, on } from "../../lib/events.ts";
  import { stockState } from "../../lib/format.ts";
  import type { CardProduct } from "../../lib/types.ts";
  import type { DropletActions, DropletProps } from "./$types";

  let { data, form }: DropletProps = $props();
  const add = actionUrl<DropletActions>("add");

  let fresh = $state<Partial<CardProduct>>({});
  const product = $derived({ ...data.product, ...fresh });

  onMount(() =>
    // An admin changed this product: read its stock and price again.
    on("shop:product-changed", async (detail) => {
      if (!isRecord(detail) || detail["id"] !== data.product.id) return;
      const [info] = await checkStock([data.product.id]);
      if (info) fresh = { stock: info.stock, stockState: stockState(info.stock), salePriceCents: info.salePriceCents };
    })
  );
</script>

<ProductCard {product} action={add} {form} featured />

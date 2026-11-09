<script lang="ts">
  // The product card: product-library renders a grid of them, product-card
  // one. Svelte's own, so only Svelte droplets import it. `action` is the
  // droplet's `?/add` URL (from `actionUrl("add")`); `form` its last result.
  // The form is enhanced: once the droplet is live it posts by `fetch`, the
  // result goes to the toast center as a toast (the MessageBridge), the
  // droplet renders again with it (the button says "✓ Added") and
  // `droplets:action` tells the cart. Before that, or without JavaScript,
  // it posts as any form does and the page comes back with the button so.
  import { enhanceDropletForm } from "@dropletsjs/renderer-svelte/form";
  import type { EnhanceResult } from "@dropletsjs/droplets/enhance";
  import { imageUrl } from "../api.ts";
  import { formatMoney, productHref, stockLabel } from "../format.ts";
  import { addToast, sendMessage } from "../message-bridge.ts";
  import type { CardProduct } from "../types.ts";

  type Props = { product: CardProduct; action: string; form?: unknown; featured?: boolean };
  let { product, action, form, featured = false }: Props = $props();

  const result = $derived(form && typeof form === "object" ? (form as { added?: unknown }) : null);
  const out = $derived(product.stockState === "out");
  const added = $derived(result?.added === product.id);
  const href = $derived(productHref(product.slug, product.v));

  /** The add's result as a toast, with this card's product name; then the default render. */
  function toast(answer: EnhanceResult) {
    const message = answer.type === "redirect" ? null : addToast(answer.data, product.name);
    if (message) sendMessage("toast", message);
    return answer.update();
  }
</script>

<article class="card" class:out class:featured>
  <a class="media" {href} tabindex="-1" aria-hidden="true">
    <img src={imageUrl(product.image)} alt="" loading="lazy" width="400" height="400" />
    <span class="badges">
      {#if product.badges.includes("sale")}<span class="badge sale">Sale −{product.salePct}%</span>{/if}
      {#if product.badges.includes("new")}<span class="badge new">New</span>{/if}
    </span>
  </a>
  <h3 class="name"><a {href}>{product.name}</a></h3>
  <p class="price">
    {#if product.salePriceCents !== null}
      <s>{formatMoney(product.priceCents, product.currency)}</s>
      <b class="sale">{formatMoney(product.salePriceCents, product.currency)}</b>
    {:else}
      <b>{formatMoney(product.priceCents, product.currency)}</b>
    {/if}
  </p>
  <p class="stock stock-{product.stockState}">{stockLabel(product.stockState, product.stock)}</p>
  <form method="post" {action} use:enhanceDropletForm={{ action: "add", onResult: toast }}>
    <input type="hidden" name="productId" value={product.id} />
    <button class="button primary" disabled={out}>
      {out ? "Out of stock" : added ? "✓ Added" : "Add to cart"}
    </button>
  </form>
</article>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: calc(var(--radius) + 4px);
    background: var(--paper);
    transition: box-shadow 0.15s;
  }

  .card:hover {
    box-shadow: var(--shadow);
  }

  .media {
    position: relative;
    display: block;
    overflow: hidden;
    border-radius: var(--radius);
    background: var(--grey-soft);
    aspect-ratio: 1;
  }

  .media img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .out .media img {
    filter: grayscale(1) opacity(0.6);
  }

  .badges {
    position: absolute;
    top: 0.6rem;
    left: 0.6rem;
    display: flex;
    gap: 0.3rem;
  }

  .name {
    margin: 0.3rem 0 0;
    font-size: 1rem;
    line-height: 1.3;
  }

  .name a {
    color: inherit;
    text-decoration: none;
  }

  .name a:hover {
    text-decoration: underline;
  }

  .price {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    margin: 0;
  }

  .price s {
    color: var(--grey);
  }

  .price .sale {
    color: var(--coral);
  }

  form {
    display: grid;
    gap: 0.4rem;
    margin-top: auto;
    padding-top: 0.4rem;
  }

  .featured {
    max-width: 320px;
  }
</style>

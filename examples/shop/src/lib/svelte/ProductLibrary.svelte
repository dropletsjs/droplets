<script lang="ts">
  import { onMount } from "svelte";
  import type { Data } from "../../droplets/product-library/$types";
  import { listProducts } from "../api.ts";
  import { emit, on, readFilter } from "../events.ts";
  import { formatDate } from "../format.ts";
  import type { CardProduct, Filter } from "../types.ts";
  import ProductCard from "./ProductCard.svelte";

  // product-library's grid, with its loaded `data`. Server-rendered from the
  // host's query (works without JavaScript: the pager and the sort are plain
  // GET links and forms). Once hydrated it listens for `shop:filter` and
  // refetches /api/products in place. `add` is the droplet's `?/add` URL.
  type Props = { data: Data; add: string; form?: unknown };
  let { data, add, form }: Props = $props();

  type View = { items: CardProduct[]; total: number; filter: Filter & { scope: string } };
  let fetched = $state<View | null>(null);
  let loading = $state(false);
  let mounted = $state(false);
  const view: View = $derived(fetched ?? { items: data.items, total: data.total, filter: data.filter });
  const pageCount = $derived(fetched ? 1 : data.pageCount);

  /** The page's query for a filter: what the no-JS links write, and what replaceState keeps. */
  function query(filter: Filter, page = 1): string {
    const params = new URLSearchParams();
    if (filter.q) params.set("q", filter.q);
    if (filter.category) params.set("category", filter.category);
    if (filter.sort !== "new") params.set("sort", filter.sort);
    if (filter.onSale) params.set("onSale", "1");
    if (page > 1) params.set("page", String(page));
    return `?${params}`;
  }

  async function refetch(filter: Filter & { scope: string }) {
    loading = true;
    try {
      // One page of the size the host asked for; the pager returns on reload.
      const list = await listProducts(filter, { limit: data.pageSize });
      fetched = { items: list.items, total: list.total, filter };
      history.replaceState(history.state, "", query(filter));
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    mounted = true;
    const stops = [
      on("shop:filter", (detail) => {
        const filter = readFilter(detail);
        if (filter && filter.scope === data.filter.scope) void refetch(filter);
      }),
      // An admin saved a product: show its new stock and price.
      on("shop:product-changed", () => void refetch(view.filter)),
    ];
    return () => stops.forEach((stop) => stop());
  });

  function sortChanged(event: Event) {
    const sort = (event.currentTarget as HTMLSelectElement).value as Filter["sort"];
    emit("shop:filter", { ...view.filter, sort });
  }
</script>

<section class="library" class:loading aria-busy={loading}>
  {#if data.campaign}
    <p class="campaign">
      <span class="badge sale">{data.campaign.name} −{data.campaign.pct}%</span>
      on selected products{#if data.campaign.endsAt}, until {formatDate(data.campaign.endsAt)}{/if}
    </p>
  {/if}

  <header>
    <p class="count" role="status">{view.total} {view.total === 1 ? "product" : "products"}</p>
    <form method="get" class="sort">
      {#if view.filter.q}<input type="hidden" name="q" value={view.filter.q} />{/if}
      {#if view.filter.category}<input type="hidden" name="category" value={view.filter.category} />{/if}
      {#if view.filter.onSale}<input type="hidden" name="onSale" value="1" />{/if}
      <label>
        Sort
        <select class="field" name="sort" value={view.filter.sort} onchange={sortChanged}>
          <option value="new">Newest</option>
          <option value="price-asc">Price, low to high</option>
          <option value="price-desc">Price, high to low</option>
        </select>
      </label>
      {#if !mounted}<button class="button">Sort</button>{/if}
    </form>
  </header>

  {#if view.items.length}
    <ul class="grid">
      {#each view.items as product (product.id)}
        <li><ProductCard {product} action={add} {form} /></li>
      {/each}
    </ul>
  {:else}
    <p class="empty">Nothing matches. Try another category or fewer words.</p>
  {/if}

  {#if pageCount > 1}
    <nav class="pager" aria-label="Pages">
      {#if data.page > 1}<a class="button" href={query(view.filter, data.page - 1)} rel="prev">‹</a>{/if}
      {#each Array.from({ length: pageCount }, (_, i) => i + 1) as n (n)}
        <a class="button" class:current={n === data.page} aria-current={n === data.page ? "page" : undefined}
          href={query(view.filter, n)}>{n}</a>
      {/each}
      {#if data.page < pageCount}<a class="button" href={query(view.filter, data.page + 1)} rel="next">›</a>{/if}
    </nav>
  {/if}
</section>

<style>
  .library {
    display: grid;
    gap: 1rem;
  }

  .loading .grid {
    opacity: 0.5;
    transition: opacity 0.2s;
  }

  .campaign {
    margin: 0;
    padding: 0.7rem 1rem;
    border-radius: var(--radius);
    background: var(--coral-soft);
    font-weight: 600;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    justify-content: space-between;
  }

  .count {
    margin: 0;
    font-weight: 700;
  }

  .sort {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .sort label {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.9rem;
    color: var(--muted);
  }

  .sort select {
    width: auto;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  @media (max-width: 480px) {
    .grid {
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
  }

  .grid > li {
    display: flex;
  }

  .grid > li > :global(*) {
    flex: 1;
  }

  .empty {
    padding: 3rem 1rem;
    text-align: center;
    color: var(--muted);
  }

  .pager {
    display: flex;
    gap: 0.4rem;
    justify-content: center;
  }

  .pager .current {
    border-color: var(--brand);
    background: var(--brand-soft);
  }
</style>

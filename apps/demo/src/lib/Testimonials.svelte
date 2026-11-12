<script lang="ts">
  import type { Testimonial } from "./testimonials.ts";

  let { testimonials, onRefresh }: { testimonials: Testimonial[]; onRefresh?: () => void } = $props();

  // False in the server's HTML: the button exists only where it can work.
  let mounted = $state(false);
  let busy = $state(false);
  $effect(() => {
    mounted = true;
  });

  async function refresh() {
    if (!onRefresh || busy) return;
    busy = true;
    try {
      await onRefresh();
    } finally {
      busy = false;
    }
  }
</script>

<ul class="testimonials">
  {#each testimonials as item (item.id)}
    <li>
      <p class="text">{item.text}</p>
      <p class="author">{item.author} <span>#{item.id}</span></p>
    </li>
  {/each}
</ul>
{#if mounted && onRefresh}
  <p class="demo-row">
    <button type="button" class="demo-button secondary" disabled={busy} onclick={refresh}>
      {busy ? "Loading…" : "Refresh"}
    </button>
  </p>
{/if}

<style>
  .testimonials {
    display: grid;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    padding: 0 0 0 0.75rem;
    border-left: 3px solid var(--demo-line);
  }
  p {
    margin: 0;
  }
  .text {
    font-size: 0.9375rem;
  }
  .author {
    margin-top: 0.25rem;
    color: var(--demo-muted);
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .author span {
    font: 400 0.75rem var(--demo-mono);
  }
</style>

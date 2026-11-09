<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>Gallery · Droplets Shop on {data.stack}</title>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- the shop's preloads, parsed and escaped -->
  {@html data.head}
</svelte:head>

<section class="shop-hero">
  <h1>Everything a demo shop needs.</h1>
  <p>Rendered by six frameworks, embedded by {data.stack}.</p>
</section>
<div class="shop-gallery">
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted: the shop's fragment -->
  <aside>{@html data.filter}</aside>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted: the shop's fragment -->
  <div>{@html data.library}</div>
</div>

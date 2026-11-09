<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>{data.product.name} · Droplets Shop on {data.stack}</title>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- the shop's preloads, parsed and escaped -->
  {@html data.head}
</svelte:head>

<nav class="shop-crumbs" aria-label="Breadcrumb">
  <a href="/gallery">Gallery</a> ›
  <a href={data.categoryHref}>{data.product.category.name}</a> ›
  <span aria-current="page">{data.product.name}</span>
</nav>
<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted: the shop's fragment -->
{@html data.page}
<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted: the shop's fragment -->
<section class="shop-comments">{@html data.comments}</section>

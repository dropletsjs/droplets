<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>Log in · Droplets Shop on {data.stack}</title>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- the shop's preloads, parsed and escaped -->
  {@html data.head}
</svelte:head>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted: the shop's fragment -->
<div class="shop-narrow">{@html data.login}</div>

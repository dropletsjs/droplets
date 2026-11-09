<script lang="ts">
  import { page } from "$app/state";
</script>

<svelte:head>
  <title>{page.status === 404 ? "Not found" : "Error"} · Droplets Shop</title>
</svelte:head>

<div class="shop-narrow shop-notice">
  <h1>{page.status === 404 ? "Not found" : "Something broke"}</h1>
  <p>{page.error?.message}</p>
  <p><a href="/gallery">Back to the gallery</a></p>
</div>

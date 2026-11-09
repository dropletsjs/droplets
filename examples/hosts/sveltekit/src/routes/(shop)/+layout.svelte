<script lang="ts">
  // The shop's one layout: the toasts droplet first, the header (logo, nav,
  // the cart badge droplet), the page, and the footer naming this host's stack.
  import { page } from "$app/state";

  let { data, children } = $props();

  const nav = [
    ["/gallery", "Gallery"],
    ["/admin", "Admin"],
  ];
  const speculation = JSON.stringify({
    prefetch: [{ where: { href_matches: "/product/*" }, eagerness: "moderate" }],
  });
</script>

<svelte:head>
  <link rel="stylesheet" href="/shop.css" />
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- the shop's preloads, parsed and escaped -->
  {@html data.layoutHead}
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- a constant -->
  {@html `<script type="speculationrules">${speculation}</script>`}
  <script type="module" src="/index.js"></script>
</svelte:head>

<!-- Full page loads, as on every other host: each page is fetched with its fragments. -->
<div data-sveltekit-reload style="display: contents">
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted: the shop's fragment -->
  {@html data.toasts}
  <header class="shop-header">
    <div class="shop-wrap">
      <a class="shop-logo" href="/gallery"><span aria-hidden="true">◆</span> Droplets Shop</a>
      <nav class="shop-nav" aria-label="Shop">
        {#each nav as [href, label] (href)}
          <a {href} aria-current={page.url.pathname === href ? "page" : undefined}>{label}</a>
        {/each}
      </nav>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted: the shop's fragment -->
      <div class="shop-cart">{@html data.cart}</div>
    </div>
  </header>
  <main class="shop-main shop-wrap">
    {@render children()}
  </main>
  <footer class="shop-footer">
    <div class="shop-wrap">
      <p class="shop-stack">{data.stack}</p>
      <p>Droplets demo shop · host: {data.stack} · droplets: &lt;djs-shop&gt;</p>
      <p><a href="/gallery">Gallery</a> · <a href="/admin">Admin</a> · <a href="/">The Svelte example</a></p>
    </div>
  </footer>
</div>

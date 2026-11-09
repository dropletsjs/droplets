<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>Droplets in SvelteKit</title>
  <!-- The droplets entry client; it defines the server's droplet element. -->
  <script type="module" src="{data.dropletsUrl}/index.js"></script>
</svelte:head>

<main style="max-width: 48rem; margin: 0 auto;">
  <h1>SvelteKit page, three Svelte droplets from another server</h1>
  <p>
    Fragments fetched in <code>+page.server.ts</code> and rendered on the server.
    Try <a href="/?who=Kit">?who=Kit</a>, or the <a href="/gallery" data-sveltekit-reload>shop demo</a>.
  </p>
  {#each data.fragments as fragment}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted: our own droplets server -->
    {@html fragment}
  {/each}
</main>

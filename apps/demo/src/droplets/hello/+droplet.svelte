<script module lang="ts">
  export const ssr = true;
  export const hydrate = true;
</script>

<script lang="ts">
  import type { DropletProps } from "./$types";

  // The value the server rendered with when hydrating; a promise when the
  // element mounts it fresh (a host that wrote the element itself).
  let { data }: DropletProps = $props();

  // False in the server's HTML; true once this component runs in the browser.
  let hydrated = $state(false);
  $effect(() => {
    hydrated = true;
  });
</script>

{#await data then hello}
  <section class="demo-card" data-hydrated={hydrated}>
    <p class="demo-row"><span class="demo-tag">hello · Svelte</span></p>
    <p class="demo-title">{hello.greeting}</p>
    <p class="demo-muted">
      Rendered by the demo server at <time datetime={hello.renderedAt}>{hello.renderedAt.slice(0, 19).replace("T", " ")} UTC</time>,
      {#if hydrated}<span class="demo-ok">hydrated in this page</span>{:else}waiting for its bundle{/if}.
    </p>
  </section>
{/await}

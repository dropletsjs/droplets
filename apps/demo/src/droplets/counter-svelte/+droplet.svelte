<script module lang="ts">
  export const ssr = true;
  export const hydrate = true;
</script>

<script lang="ts">
  import type { DropletProps } from "./$types";

  // What the server load returned. A value here: without Svelte's
  // experimental.async the renderer waits for it before mounting.
  let { data }: DropletProps = $props();

  let added = $state(0);
  // False in the server's HTML; true once this component runs in the browser.
  let hydrated = $state(false);
  $effect(() => {
    hydrated = true;
  });
</script>

{#await data then { framework, start }}
  <section class="demo-card" data-hydrated={hydrated}>
    <p class="demo-row"><span class="demo-tag">counter · {framework}</span></p>
    <p class="demo-row">
      <output class="demo-title" aria-live="polite">{start + added}</output>
      <button type="button" class="demo-button" onclick={() => (added += 1)}>Add one</button>
    </p>
    <p class="demo-muted">
      {hydrated ? `Hydrated: ${framework} runs the button in this tab.` : `Server HTML: the button works once ${framework} hydrates.`}
    </p>
  </section>
{/await}

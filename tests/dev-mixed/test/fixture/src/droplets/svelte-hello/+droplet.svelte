<script module lang="ts">
  export const ssr = true;
  export const hydrate = true;
</script>

<script lang="ts">
  let { data }: { data: { word: string } } = $props();
  let count = $state(0);
  let hydrated = $state(false);
  $effect(() => {
    hydrated = true;
  });
</script>

<section data-testid="svelte" data-hydrated={hydrated}>
  <p data-text>Svelte greets the host</p>
  <p data-word>{data.word}</p>
  <button type="button" onclick={() => (count += 1)}>{count}</button>
</section>

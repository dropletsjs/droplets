<script module lang="ts">
  export const ssr = true;
  export const hydrate = false;
  export const prerender = false;
</script>

<script lang="ts">
  import Testimonials from "../../lib/Testimonials.svelte";
  import type { DropletProps } from "./$types";

  let { data }: DropletProps = $props();
</script>

{#await data then loaded}
  <section class="demo-card">
    <p class="demo-row"><span class="demo-tag">testimonials · server only</span></p>
    <p class="demo-muted">Rendered on the server from event.fetch. No JavaScript: ask for the fragment again for ten others.</p>
    <Testimonials testimonials={loaded.testimonials} />
  </section>
{/await}

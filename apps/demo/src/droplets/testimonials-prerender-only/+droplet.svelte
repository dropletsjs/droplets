<script module lang="ts">
  export const ssr = false;
  export const hydrate = false;
  export const prerender = true;
</script>

<script lang="ts">
  import Testimonials from "../../lib/Testimonials.svelte";
  import type { DropletProps } from "./$types";

  let { data }: DropletProps = $props();
</script>

{#await data then loaded}
  <section class="demo-card">
    <p class="demo-row"><span class="demo-tag">testimonials · prerendered · page {loaded.page} of {loaded.pages}</span></p>
    <p class="demo-muted">Rendered once at build. No JavaScript, no render per request.</p>
    <Testimonials testimonials={loaded.testimonials} />
  </section>
{/await}

<script module lang="ts">
  export const ssr = false;
  export const hydrate = true;
  export const prerender = false;
</script>

<script lang="ts">
  import Testimonials from "../../lib/Testimonials.svelte";
  import type { Testimonial } from "../../lib/testimonials.ts";
  import type { DropletProps } from "./$types";
  import { refetch } from "./store.ts";

  // A promise: nothing rendered on the server, the load runs here.
  let { data }: DropletProps = $props();

  let fresh = $state<Testimonial[] | null>(null);

  async function refresh() {
    fresh = await refetch();
  }
</script>

<section class="demo-card">
  <p class="demo-row"><span class="demo-tag">testimonials · client only</span></p>
  {#await data}
    <p class="demo-muted">Loading in the browser…</p>
  {:then loaded}
    <p class="demo-muted">
      {fresh ? "Refreshed: IndexedDB cleared, then fetched from the API and kept." : `From ${loaded.from}, in this browser.`}
    </p>
    <Testimonials testimonials={fresh ?? loaded.testimonials} onRefresh={refresh} />
  {:catch failure}
    <p class="demo-error">{failure instanceof Error ? failure.message : "Could not load the testimonials."}</p>
  {/await}
</section>

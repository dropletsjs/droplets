<script module lang="ts">
  export const ssr = true;
  export const hydrate = true;
  export const prerender = false;
</script>

<script lang="ts">
  import Testimonials from "../../lib/Testimonials.svelte";
  import { fetchRandomTestimonials } from "../../lib/testimonials-api.ts";
  import type { Testimonial } from "../../lib/testimonials.ts";
  import type { DropletProps } from "./$types";

  // What the server load returned, inline in the fragment.
  let { data }: DropletProps = $props();

  let fresh = $state<Testimonial[] | null>(null);

  async function refresh() {
    fresh = await fetchRandomTestimonials();
  }
</script>

{#await data then loaded}
  <section class="demo-card">
    <p class="demo-row"><span class="demo-tag">testimonials · server + client</span></p>
    <p class="demo-muted">
      {fresh ? "Refreshed in the browser from the API." : "Rendered on the server from event.fetch, then hydrated."}
    </p>
    <Testimonials testimonials={fresh ?? loaded.testimonials} onRefresh={refresh} />
  </section>
{/await}

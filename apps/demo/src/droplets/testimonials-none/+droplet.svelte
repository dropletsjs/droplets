<script module lang="ts">
  // All three off: no markup from the server, no JavaScript in the browser,
  // nothing at build. The fragment is an empty element.
  export const ssr = false;
  export const hydrate = false;
  export const prerender = false;
</script>

<script lang="ts">
  import Testimonials from "../../lib/Testimonials.svelte";
</script>

<Testimonials testimonials={[]} />

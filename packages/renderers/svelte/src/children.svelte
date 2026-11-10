<!--
  The `children` snippet every Svelte droplet receives: the marker the
  element fills with the host's container. Exported from the module script
  so the renderer can hand one snippet to any component; `use:fill` reports
  the marker once it is in the DOM, `out:release|global` hands the container
  back before Svelte removes the marker (see `./children.ts`).
-->
<script module lang="ts">
  // `.js`: the file ships next to the compiled module, where tsc has no say.
  import { fill, release } from "./children.js";

  export { marker };
</script>

{#snippet marker()}<div data-droplet-children style="display: contents" use:fill out:release|global></div>{/snippet}

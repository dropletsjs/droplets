<script lang="ts">
  // `error` is what handleError in +droplet.server.ts returns.
  import type { DropletErrorProps } from "./$types";

  let { error }: DropletErrorProps = $props();
</script>

<section class="card">
  <p class="code">Oops</p>
  <p class="card-summary">{error.message}</p>
</section>

<style>
  /* Compiled with injected CSS: these styles travel with the markup. */
  .code {
    font: 600 2.5rem/1 ui-monospace, monospace;
    color: #be123c;
  }
</style>

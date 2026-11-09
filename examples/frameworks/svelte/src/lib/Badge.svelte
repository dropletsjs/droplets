<script lang="ts">
  // Shared between the droplets: editing this file refreshes every droplet
  // that imports it, which the dev server works out from the module graph.
  let { label }: { label: string } = $props();
</script>

<span class="card-framework">{label}</span>

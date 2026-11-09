<script setup lang="ts">
// `error` is what handleError in +droplet.server.ts returns.
import type { DropletErrorProps } from "./$types";

defineProps<DropletErrorProps>();
</script>

<template>
  <section class="card">
    <p class="card-error">Oops</p>
    <p class="card-summary">{{ error.message }}</p>
  </section>
</template>

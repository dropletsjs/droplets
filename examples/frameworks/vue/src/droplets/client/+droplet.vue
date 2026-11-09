<script lang="ts">
// Nothing on the server: the element mounts it in the browser, and the
// card fetches what it shows from /api.
export const ssr = false;
export const hydrate = true;
</script>

<script setup lang="ts">
import Card from "../../lib/Card.vue";

defineProps<{ data: unknown }>();
</script>

<template>
  <Card mode="client" />
</template>

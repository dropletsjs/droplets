<script lang="ts">
export const hydrate = false;
</script>

<script setup lang="ts">
defineProps<{ data: unknown }>();
</script>

<template>
  <p class="note">Rendered on the server only.</p>
</template>

<style>
  .note {
    font-style: italic;
  }
</style>

<script lang="ts">
export const prerender = true;
</script>

<script setup lang="ts">
defineProps<{ data: { page: number } }>();
</script>

<template>
  <article data-testid="docs"><h1>Page {{ data.page }}</h1><p>@HOST@</p></article>
</template>

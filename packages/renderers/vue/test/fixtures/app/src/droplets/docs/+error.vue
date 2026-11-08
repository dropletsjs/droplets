<script setup lang="ts">
defineProps<{ error: { message: string } }>();
</script>

<template>
  <p data-testid="docs-error">{{ error.message }}</p>
</template>

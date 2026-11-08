<script setup lang="ts">
import { ref } from "vue";
import { DropletChildren } from "@dropletsjs/renderer-vue/children";

defineProps<{ error: { message: string } }>();
const tries = ref(0);
</script>

<template>
  <p class="oops" data-testid="error">{{ error.message }}</p>
  <button data-testid="retry" @click="tries += 1">{{ tries }}</button>
  <div data-testid="error-children"><DropletChildren /></div>
</template>

<style scoped>
  /* Inlined by the renderer: travels with the markup. */
  .oops { color: crimson; }
</style>

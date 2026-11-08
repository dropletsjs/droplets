<script lang="ts">
// Client-only: the server leaves an empty element and the browser mounts.
export const ssr = false;
</script>

<script setup lang="ts">
import { DropletChildren } from "@dropletsjs/renderer-vue/children";

defineProps<{ data: unknown }>();
</script>

<template>
  <div data-testid="frame"><DropletChildren /></div>
</template>

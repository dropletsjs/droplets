<script lang="ts">
export const ssr = true;
export const hydrate = false;
</script>

<script setup lang="ts">
import Card from "../../lib/Card.vue";
// Generated from this folder's files: `data` is what the server load returns.
import type { DropletProps } from "./$types";

const props = defineProps<DropletProps>();
// The value the server rendered with when hydrating; a promise when the
// element mounts it fresh: the renderer's <Suspense> waits.
const data = await props.data;
</script>

<template>
  <Card mode="ssr-nohydrate" :data="data" />
</template>

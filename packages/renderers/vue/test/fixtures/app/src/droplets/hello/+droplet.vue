<script lang="ts">
export const ssr = true;
export const hydrate = true;
</script>

<script setup lang="ts">
import { ref } from "vue";
import type { DropletProps } from "@dropletsjs/renderer-vue";
import { DropletChildren } from "@dropletsjs/renderer-vue/children";

const props = defineProps<DropletProps<{ greeting: string }>>();
// The value when hydrating, a promise when mounted from scratch: the
// renderer's <Suspense> waits, and a rejection reaches its error boundary.
const { greeting } = await props.data;
const clicks = ref(0);
</script>

<template>
  <section>
    <h1 data-testid="greeting">{{ greeting }}</h1>
    <button data-testid="count" @click="clicks += 1">{{ clicks }}</button>
    <div data-testid="children"><DropletChildren /></div>
  </section>
</template>

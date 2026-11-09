<script lang="ts">
export const ssr = true;
export const hydrate = true;
</script>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useGreeting } from "../../lib/useGreeting.ts";

function useHydrated() {
  const hydrated = ref(false);
  onMounted(() => (hydrated.value = true));
  return hydrated;
}

const greeting = useGreeting("the host");
const hydrated = useHydrated();
const count = ref(0);
</script>

<template>
  <section data-testid="vue" :data-hydrated="hydrated">
    <p data-text>{{ greeting }}</p>
    <button type="button" @click="count++">{{ count }}</button>
  </section>
</template>

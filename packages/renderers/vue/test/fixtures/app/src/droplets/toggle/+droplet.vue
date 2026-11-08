<script setup lang="ts">
import { ref } from "vue";
import { DropletChildren } from "@dropletsjs/renderer-vue/children";

// Not part of the conformance scenarios: a v-if around the host's children,
// for the browser check of the hide/show contract.
defineProps<{ data: unknown }>();
const open = ref(true);
</script>

<template>
  <section data-testid="toggle">
    <button data-testid="toggle-button" @click="open = !open">{{ open ? "close" : "open" }}</button>
    <div v-if="open" data-testid="toggle-children"><DropletChildren /></div>
  </section>
</template>

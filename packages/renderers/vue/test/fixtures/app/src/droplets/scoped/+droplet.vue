<script setup lang="ts">
import { ref } from "vue";
import { DropletChildren } from "@dropletsjs/renderer-vue/children";

// Not part of the conformance scenarios: exercises scoped styles around the
// host's slot and a v-if that removes and re-creates it (browser check).
defineProps<{ data: unknown }>();
const open = ref(true);
</script>

<template>
  <section class="box" data-testid="scoped">
    <button data-testid="toggle" @click="open = !open">{{ open ? "close" : "open" }}</button>
    <div v-if="open" data-testid="scoped-children"><DropletChildren /></div>
  </section>
</template>

<style scoped>
  .box { border-left: 3px solid rgb(0, 128, 0); }
</style>

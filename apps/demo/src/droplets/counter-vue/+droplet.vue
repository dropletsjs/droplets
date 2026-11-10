<script lang="ts">
export const ssr = true;
export const hydrate = true;
</script>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { DropletProps } from "./$types";

const props = defineProps<DropletProps>();
// What the server load returned. A value when hydrating, a promise when the
// element mounts it fresh: the renderer's <Suspense> waits for it.
const { framework, start } = await props.data;

const added = ref(0);
// False in the server's HTML; true once this component runs in the browser.
const hydrated = ref(false);
onMounted(() => (hydrated.value = true));
</script>

<template>
  <section class="demo-card" :data-hydrated="hydrated">
    <p class="demo-row"><span class="demo-tag">counter · {{ framework }}</span></p>
    <p class="demo-row">
      <output class="demo-title" aria-live="polite">{{ start + added }}</output>
      <button type="button" class="demo-button" @click="added += 1">Add one</button>
    </p>
    <p class="demo-muted">
      {{ hydrated ? `Hydrated: ${framework} runs the button in this tab.` : `Server HTML: the button works once ${framework} hydrates.` }}
    </p>
  </section>
</template>

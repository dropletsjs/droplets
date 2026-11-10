<script lang="ts">
export const ssr = true;
export const hydrate = true;
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { actionUrl } from "$droplets/form";
import { useEnhanceDropletForm } from "@dropletsjs/renderer-vue/form";
import type { DropletActions, DropletProps } from "./$types";

const props = defineProps<DropletProps>();

// Once hydrated, the vote posts by fetch and the result shows in place;
// before that, or without JavaScript, the form posts as any form does.
// actionUrl() knows the droplet only while setup runs synchronously: before
// the first `await`.
const vote = actionUrl<DropletActions>("vote");
const formRef = ref<HTMLFormElement | null>(null);
useEnhanceDropletForm<DropletActions>(formRef, { action: "vote" });

// The value the server rendered with when hydrating; a promise when the
// element mounts it fresh: the renderer's <Suspense> waits.
const data = await props.data;

const hydrated = ref(false);
onMounted(() => (hydrated.value = true));

const MESSAGES = {
  missing: "Pick one of the answers first.",
  unknown: "That is not one of the answers.",
  unreadable: "The form could not be read.",
} as const;

const result = computed(() => (props.form && "voted" in props.form ? props.form : null));
const failure = computed(() => (props.form && "code" in props.form ? MESSAGES[props.form.code] : null));
</script>

<template>
  <section class="demo-card" :data-hydrated="hydrated">
    <p class="demo-row"><span class="demo-tag">poll · Vue</span></p>
    <form ref="formRef" method="post" :action="vote" class="poll" novalidate>
      <fieldset>
        <legend class="demo-title">{{ data.question }}</legend>
        <label v-for="answer in data.answers" :key="answer.id" class="demo-choice">
          <input type="radio" name="answer" :value="answer.id" :checked="result?.voted === answer.id" />
          {{ answer.label }}
        </label>
      </fieldset>
      <p class="demo-row">
        <button type="submit" class="demo-button">Vote</button>
        <span v-if="result" class="demo-ok" role="status" data-result>You picked {{ result.label }}. Nothing was stored.</span>
      </p>
      <p v-if="failure" class="demo-error" role="alert" data-failure>{{ failure }}</p>
    </form>
    <p class="demo-muted">The server checks the vote and echoes it back; it keeps nothing.</p>
  </section>
</template>

<style scoped>
.poll fieldset {
  margin: 0;
  padding: 0;
  border: 0;
}
.poll legend {
  margin-bottom: 0.5rem;
  padding: 0;
  font-size: 1rem;
}
.demo-choice {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  margin: 0 1rem 0.375rem 0;
  font-size: 0.9375rem;
  cursor: pointer;
}
.poll > * + * {
  margin-top: 0.75rem;
}
</style>

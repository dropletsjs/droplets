<script setup lang="ts">
// A `<form method="post">` to one of the droplet's actions, enhanced: once
// the droplet is live it posts by `fetch` and the droplet renders again
// with the result as `form` (its load run again); before that, or without
// JavaScript, it posts as any form does. Other attributes (`class`,
// `enctype`) fall through to the form.
import { ref } from "vue";
import { useEnhanceDropletForm } from "@dropletsjs/renderer-vue/form";

defineProps<{ action: string }>();
const form = ref<HTMLFormElement | null>(null);
useEnhanceDropletForm(form);
</script>

<template>
  <form ref="form" method="post" :action="action"><slot /></form>
</template>

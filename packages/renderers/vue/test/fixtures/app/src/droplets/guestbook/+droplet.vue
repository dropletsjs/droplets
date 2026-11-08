<script lang="ts">
export const prerender = true;
</script>

<script setup lang="ts">
import { ref } from "vue";
import { actionUrl } from "$droplets/form";
import type { DropletProps } from "@dropletsjs/renderer-vue";
import { useEnhanceDropletForm } from "@dropletsjs/renderer-vue/form";

// What the last action returned, or its fail() data. `sign` and `leave`
// are enhanced; `plain` posts as any form does.
defineProps<DropletProps<{ count: number }, { message: string }>>();
const urls = { sign: actionUrl(), leave: actionUrl("leave"), echo: actionUrl("echo") };
const sign = ref<HTMLFormElement | null>(null);
const leave = ref<HTMLFormElement | null>(null);
useEnhanceDropletForm(sign);
useEnhanceDropletForm(leave, { action: "leave" });
</script>

<template>
  <form ref="sign" method="post" :action="urls.sign" data-testid="sign"><input name="name" /><p data-testid="form">{{ form?.message ?? "none" }}</p></form>
  <form ref="leave" method="post" :action="urls.leave" data-testid="leave"></form>
  <form method="post" :action="urls.echo" data-testid="plain"></form>
</template>

<script setup lang="ts">
// The card every droplet of this example shows, in its own mode. The
// modules next to it (api.ts, modes.ts) are plain TypeScript.
import { computed, onMounted, ref } from "vue";
import { env } from "$droplets/env/public";
import { bumpCounter, privateFacts, readCounter, serverTime } from "./api.ts";
import { MODES } from "./modes.ts";
import type { Facts, Mode, PrivateFacts } from "./types.ts";
// A file the droplet imports: its URL is on the droplets server, wherever the page is.
import logo from "./droplet.png";

const props = defineProps<{ mode: Mode; data?: Facts }>();

const hydrated = ref(false);
const count = ref<number | null>(null);
const fetched = ref<PrivateFacts | null>(null);
const time = ref<string | null>(null);

// Runs in the browser only, after the server markup is adopted (or mounted).
onMounted(() => {
  hydrated.value = true;
  if (props.mode !== "client") return;
  readCounter().then((n) => (count.value = n));
  privateFacts().then((facts) => (fetched.value = facts));
  serverTime().then((now) => (time.value = now));
});

const facts = computed(() => props.data ?? fetched.value);
const shown = computed(() => count.value ?? props.data?.count ?? null);
const site = env.PUBLIC_SITE_NAME;
const banner = env.PUBLIC_BANNER ?? "not set";

async function bump() {
  count.value = await bumpCounter();
}
</script>

<template>
  <article class="card" data-testid="card" data-framework="vue" :data-mode="mode">
    <header class="card-head">
      <img class="card-logo" data-testid="logo" :src="logo" alt="" width="24" height="24" />
      <span class="card-framework">Vue</span>
      <h2 class="card-title">{{ MODES[mode].title }}</h2>
    </header>
    <p class="card-summary">{{ MODES[mode].summary }}</p>
    <p v-if="data" class="card-greeting">Hello {{ data.who }}!</p>

    <dl class="card-facts">
      <dt>Site<small>public, static</small></dt>
      <dd data-testid="site">{{ site }}</dd>
      <dt>Banner<small>public, runtime</small></dt>
      <dd data-testid="banner">{{ banner }}</dd>
      <dt>API token<small>private</small></dt>
      <dd data-testid="private">{{ facts ? `${facts.apiToken}, channel ${facts.channel}` : "…" }}</dd>
      <dt>Rendered</dt>
      <dd data-testid="rendered">{{ data ? `on the server, ${data.renderedAt}` : "in the browser" }}</dd>
      <template v-if="mode === 'client'">
        <dt>Server time<small>/api/time</small></dt>
        <dd data-testid="time">{{ time ?? "…" }}</dd>
      </template>
      <dt>Hydrated</dt>
      <dd data-testid="hydrated">{{ hydrated ? "yes" : "no" }}</dd>
    </dl>

    <div class="card-counter">
      <span class="card-count" data-testid="count">{{ shown ?? "…" }}</span>
      <button v-if="mode !== 'ssr-nohydrate'" type="button" data-testid="bump" @click="bump">+1</button>
      <small>one counter for every droplet: /api/counter</small>
    </div>
  </article>
</template>

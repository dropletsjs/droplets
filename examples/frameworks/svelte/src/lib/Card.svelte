<script lang="ts">
  // The card every droplet of this example shows, in its own mode. The
  // modules next to it (api.ts, modes.ts) are plain TypeScript.
  import { env } from "$droplets/env/public";
  import { bumpCounter, privateFacts, readCounter, serverTime } from "./api.ts";
  import { MODES } from "./modes.ts";
  import type { Facts, Mode, PrivateFacts } from "./types.ts";
  import Badge from "./Badge.svelte";
  // A file the droplet imports: its URL is on the droplets server, wherever the page is.
  import logo from "./droplet.png";

  let { mode, data }: { mode: Mode; data?: Facts | undefined } = $props();

  let hydrated = $state(false);
  let count = $state<number | null>(null);
  let fetched = $state<PrivateFacts | null>(null);
  let time = $state<string | null>(null);

  // Runs in the browser only, after the server markup is adopted (or mounted).
  $effect(() => {
    hydrated = true;
    if (mode !== "client") return;
    readCounter().then((n) => (count = n));
    privateFacts().then((facts) => (fetched = facts));
    serverTime().then((now) => (time = now));
  });

  const facts = $derived(data ?? fetched);
  const shown = $derived(count ?? data?.count ?? null);

  async function bump() {
    count = await bumpCounter();
  }
</script>

<article class="card" data-testid="card" data-framework="svelte" data-mode={mode}>
  <header class="card-head">
    <img class="card-logo" data-testid="logo" src={logo} alt="" width="24" height="24" />
    <Badge label="Svelte" />
    <h2 class="card-title">{MODES[mode].title}</h2>
  </header>
  <p class="card-summary">{MODES[mode].summary}</p>
  {#if data}<p class="card-greeting">Hello {data.who}!</p>{/if}

  <dl class="card-facts">
    <dt>Site<small>public, static</small></dt>
    <dd data-testid="site">{env.PUBLIC_SITE_NAME}</dd>
    <dt>Banner<small>public, runtime</small></dt>
    <dd data-testid="banner">{env.PUBLIC_BANNER ?? "not set"}</dd>
    <dt>API token<small>private</small></dt>
    <dd data-testid="private">{facts ? `${facts.apiToken}, channel ${facts.channel}` : "…"}</dd>
    <dt>Rendered</dt>
    <dd data-testid="rendered">{data ? `on the server, ${data.renderedAt}` : "in the browser"}</dd>
    {#if mode === "client"}
      <dt>Server time<small>/api/time</small></dt>
      <dd data-testid="time">{time ?? "…"}</dd>
    {/if}
    <dt>Hydrated</dt>
    <dd data-testid="hydrated">{hydrated ? "yes" : "no"}</dd>
  </dl>

  <div class="card-counter">
    <span class="card-count" data-testid="count">{shown ?? "…"}</span>
    {#if mode !== "ssr-nohydrate"}
      <button type="button" data-testid="bump" onclick={bump}>+1</button>
    {/if}
    <small>one counter for every droplet: /api/counter</small>
  </div>
</article>

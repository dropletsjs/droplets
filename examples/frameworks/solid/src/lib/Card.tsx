/** @jsxImportSource solid-js */
// The card every droplet of this example shows, in its own mode. The
// modules next to it (api.ts, modes.ts) are plain TypeScript.
import { createSignal, onMount, Show } from "solid-js";
import { env } from "$droplets/env/public";
import { bumpCounter, privateFacts, readCounter, serverTime } from "./api.ts";
import { MODES } from "./modes.ts";
import type { Facts, Mode, PrivateFacts } from "./types.ts";
// A file the droplet imports: its URL is on the droplets server, wherever the page is.
import logo from "./droplet.png";

export function Card(props: { mode: Mode; data?: Facts | undefined }) {
  const [hydrated, setHydrated] = createSignal(false);
  const [count, setCount] = createSignal<number | null>(null);
  const [fetched, setFetched] = createSignal<PrivateFacts | null>(null);
  const [time, setTime] = createSignal<string | null>(null);

  // Runs in the browser only, after the server markup is adopted (or mounted).
  onMount(() => {
    setHydrated(true);
    if (props.mode !== "client") return;
    void readCounter().then(setCount);
    void privateFacts().then(setFetched);
    void serverTime().then(setTime);
  });

  const facts = () => props.data ?? fetched();
  const shown = () => count() ?? props.data?.count ?? null;

  return (
    <article class="card" data-testid="card" data-framework="solid" data-mode={props.mode}>
      <header class="card-head">
        <img class="card-logo" data-testid="logo" src={logo} alt="" width={24} height={24} />
        <span class="card-framework">Solid</span>
        <h2 class="card-title">{MODES[props.mode].title}</h2>
      </header>
      <p class="card-summary">{MODES[props.mode].summary}</p>
      <Show when={props.data}>{(data) => <p class="card-greeting">Hello {data().who}!</p>}</Show>

      <dl class="card-facts">
        <dt>
          Site<small>public, static</small>
        </dt>
        <dd data-testid="site">{env.PUBLIC_SITE_NAME}</dd>
        <dt>
          Banner<small>public, runtime</small>
        </dt>
        <dd data-testid="banner">{env.PUBLIC_BANNER ?? "not set"}</dd>
        <dt>
          API token<small>private</small>
        </dt>
        <dd data-testid="private">{facts() ? `${facts()!.apiToken}, channel ${facts()!.channel}` : "…"}</dd>
        <dt>Rendered</dt>
        <dd data-testid="rendered">{props.data ? `on the server, ${props.data.renderedAt}` : "in the browser"}</dd>
        <Show when={props.mode === "client"}>
          <dt>
            Server time<small>/api/time</small>
          </dt>
          <dd data-testid="time">{time() ?? "…"}</dd>
        </Show>
        <dt>Hydrated</dt>
        <dd data-testid="hydrated">{hydrated() ? "yes" : "no"}</dd>
      </dl>

      <div class="card-counter">
        <span class="card-count" data-testid="count">
          {shown() ?? "…"}
        </span>
        <Show when={props.mode !== "ssr-nohydrate"}>
          <button type="button" data-testid="bump" onClick={() => void bumpCounter().then(setCount)}>
            +1
          </button>
        </Show>
        <small>one counter for every droplet: /api/counter</small>
      </div>
    </article>
  );
}

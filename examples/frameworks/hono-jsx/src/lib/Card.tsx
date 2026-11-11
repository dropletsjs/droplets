/** @jsxImportSource hono/jsx */
// The card every droplet of this example shows, in its own mode. The
// modules next to it (api.ts, modes.ts) are plain TypeScript.
import { useEffect, useState } from "hono/jsx";
import { env } from "$droplets/env/public";
import { bumpCounter, privateFacts, readCounter, serverTime } from "./api.ts";
import { MODES } from "./modes.ts";
import type { Facts, Mode, PrivateFacts } from "./types.ts";
// A file the droplet imports: its URL is on the droplets server, wherever the page is.
import logo from "./droplet.png";

export function Card({ mode, data }: { mode: Mode; data?: Facts }) {
  const [hydrated, setHydrated] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [fetched, setFetched] = useState<PrivateFacts | null>(null);
  const [time, setTime] = useState<string | null>(null);

  // Runs in the browser only, after the server markup is adopted (or mounted).
  useEffect(() => {
    setHydrated(true);
    if (mode !== "client") return;
    void readCounter().then(setCount);
    void privateFacts().then(setFetched);
    void serverTime().then(setTime);
  }, [mode]);

  const facts = data ?? fetched;
  const shown = count ?? data?.count ?? null;

  return (
    <article class="card" data-testid="card" data-framework="hono-jsx" data-mode={mode}>
      <header class="card-head">
        <img class="card-logo" data-testid="logo" src={logo} alt="" width={24} height={24} />
        <span class="card-framework">Hono JSX</span>
        <h2 class="card-title">{MODES[mode].title}</h2>
      </header>
      <p class="card-summary">{MODES[mode].summary}</p>
      {data ? <p class="card-greeting">Hello {data.who}!</p> : null}

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
        <dd data-testid="private">{facts ? `${facts.apiToken}, channel ${facts.channel}` : "…"}</dd>
        <dt>Rendered</dt>
        <dd data-testid="rendered">{data ? `on the server, ${data.renderedAt}` : "in the browser"}</dd>
        {mode === "client" ? (
          <>
            <dt>
              Server time<small>/api/time</small>
            </dt>
            <dd data-testid="time">{time ?? "…"}</dd>
          </>
        ) : null}
        <dt>Hydrated</dt>
        <dd data-testid="hydrated">{hydrated ? "yes" : "no"}</dd>
      </dl>

      <div class="card-counter">
        <span class="card-count" data-testid="count">
          {shown ?? "…"}
        </span>
        {mode !== "ssr-nohydrate" ? (
          <button type="button" data-testid="bump" onClick={() => void bumpCounter().then(setCount)}>
            +1
          </button>
        ) : null}
        <small>one counter for every droplet: /api/counter</small>
      </div>
    </article>
  );
}

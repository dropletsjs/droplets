// The card every droplet of this example shows, in its own mode: a Lit
// element each droplet extends, naming its mode. The modules next to it
// (api.ts, modes.ts) are plain TypeScript.
import { css, html, nothing } from "lit";
import { DropletElement } from "@dropletsjs/renderer-lit/element";
import { env } from "$droplets/env/public";
import { bumpCounter, privateFacts, readCounter, serverTime } from "./api.ts";
import { MODES } from "./modes.ts";
import type { Facts, Mode, PrivateFacts } from "./types.ts";
// A file the droplet imports: its URL is on the droplets server, wherever the page is.
import logo from "./droplet.png";

/** The styles of every card and error page, in their shadow roots: page stylesheets do not reach them. */
export const cardStyles = css`
  :host {
    display: block;
  }
  .card {
    box-sizing: border-box;
    margin: 1.5rem auto;
    max-width: 36rem;
    border-radius: 0.75rem;
    background: #fff;
    padding: 1.5rem;
    box-shadow: 0 1px 2px rgb(15 23 42 / 0.06), 0 0 0 1px #e2e8f0;
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .card-framework {
    border-radius: 9999px;
    background: var(--card-accent, #0f172a);
    padding: 0.125rem 0.625rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: #fff;
  }
  .card-title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
  }
  .card-summary {
    margin: 0.5rem 0 0;
    font-size: 0.875rem;
    color: #64748b;
  }
  .card-error {
    margin: 0;
    font-family: ui-monospace, monospace;
    font-size: 2.25rem;
    font-weight: 600;
    color: #be123c;
  }
  .card-greeting {
    margin: 0.75rem 0 0;
    font-size: 1.25rem;
    font-weight: 600;
  }
  .card-facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.375rem 1rem;
    margin: 1rem 0 0;
    font-size: 0.875rem;
  }
  .card-facts dt {
    font-weight: 500;
    color: #64748b;
  }
  .card-facts dt small {
    margin-left: 0.25rem;
    font-weight: 400;
    color: #94a3b8;
  }
  .card-facts dd {
    margin: 0;
    font-family: ui-monospace, monospace;
    color: #1e293b;
  }
  .card-counter {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1.25rem;
    border-top: 1px solid #f1f5f9;
    padding-top: 1rem;
  }
  .card-count {
    font-size: 1.875rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  button {
    border: 0;
    border-radius: 0.5rem;
    background: #0f172a;
    padding: 0.375rem 0.75rem;
    font: inherit;
    font-size: 0.875rem;
    color: #fff;
    cursor: pointer;
  }
  button:hover {
    background: #334155;
  }
  .card-counter small {
    font-size: 0.75rem;
    color: #94a3b8;
  }
`;

export abstract class Card extends DropletElement<{ data: Facts | undefined }> {
  static override styles = cardStyles;
  static override properties = {
    hydrated: { state: true },
    count: { state: true },
    fetched: { state: true },
    time: { state: true },
  };

  /** Which droplet this is: each one sets it. */
  abstract readonly mode: Mode;
  declare hydrated: boolean;
  declare count: number | null;
  declare fetched: PrivateFacts | null;
  declare time: string | null;

  constructor() {
    super();
    // Set here, not as class fields: a field would hide the property Lit defines.
    this.hydrated = false;
    this.count = null;
    this.fetched = null;
    this.time = null;
  }

  // Runs in the browser only, after the server markup is adopted (or the
  // element rendered for the first time): state set before it would not
  // reach the adopted markup.
  override firstUpdated(): void {
    this.hydrated = true;
    if (this.mode !== "client") return;
    void readCounter().then((count) => (this.count = count));
    void privateFacts().then((facts) => (this.fetched = facts));
    void serverTime().then((time) => (this.time = time));
  }

  override render() {
    const data = this.data;
    const facts = data ?? this.fetched;
    const shown = this.count ?? data?.count ?? null;
    return html`
      <article class="card" data-testid="card" data-framework="lit" data-mode=${this.mode}>
        <header class="card-head">
          <img class="card-logo" data-testid="logo" src=${logo} alt="" width="24" height="24" />
          <span class="card-framework">Lit</span>
          <h2 class="card-title">${MODES[this.mode].title}</h2>
        </header>
        <p class="card-summary">${MODES[this.mode].summary}</p>
        ${data ? html`<p class="card-greeting">Hello ${data.who}!</p>` : nothing}

        <dl class="card-facts">
          <dt>Site<small>public, static</small></dt>
          <dd data-testid="site">${env.PUBLIC_SITE_NAME}</dd>
          <dt>Banner<small>public, runtime</small></dt>
          <dd data-testid="banner">${env.PUBLIC_BANNER ?? "not set"}</dd>
          <dt>API token<small>private</small></dt>
          <dd data-testid="private">${facts ? `${facts.apiToken}, channel ${facts.channel}` : "…"}</dd>
          <dt>Rendered</dt>
          <dd data-testid="rendered">${data ? `on the server, ${data.renderedAt}` : "in the browser"}</dd>
          ${this.mode === "client"
            ? html`<dt>Server time<small>/api/time</small></dt><dd data-testid="time">${this.time ?? "…"}</dd>`
            : nothing}
          <dt>Hydrated</dt>
          <dd data-testid="hydrated">${this.hydrated ? "yes" : "no"}</dd>
        </dl>

        <div class="card-counter">
          <span class="card-count" data-testid="count">${shown ?? "…"}</span>
          ${this.mode !== "ssr-nohydrate"
            ? html`<button type="button" data-testid="bump" @click=${this.#bump}>+1</button>`
            : nothing}
          <small>one counter for every droplet: /api/counter</small>
        </div>
        <!-- The host's children, in this element's light DOM, show here. -->
        <slot></slot>
      </article>
    `;
  }

  #bump = () => {
    void bumpCounter().then((count) => (this.count = count));
  };
}

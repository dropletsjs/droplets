import { css, html } from "lit";
import { DropletElement } from "@dropletsjs/renderer-lit/element";
import type { DropletProps } from "./$types";

export const ssr = true;
export const hydrate = true;

export default class Counter extends DropletElement<DropletProps> {
  static override properties = { added: { state: true }, hydrated: { state: true } };

  // The shadow root keeps the page's stylesheets out, src/app.css included;
  // custom properties inherit into it, so the card uses its --demo-* colors.
  static override styles = css`
    section {
      max-width: 36rem;
      padding: 1rem 1.25rem;
      border: 1px solid var(--demo-line);
      border-radius: var(--demo-radius);
      background: var(--demo-surface);
    }
    p {
      margin: 0;
    }
    p + p {
      margin-top: 0.75rem;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
    }
    .tag {
      padding: 0.125rem 0.5rem;
      border: 1px solid var(--demo-line);
      border-radius: 999px;
      background: var(--demo-sunken);
      color: var(--demo-muted);
      font: 500 0.75rem/1.4 var(--demo-mono);
    }
    output {
      font-size: 1.25rem;
      font-weight: 600;
    }
    button {
      min-height: 2.25rem;
      padding: 0.375rem 0.875rem;
      border: 0;
      border-radius: var(--djs-radius-sm, 4px);
      background: var(--demo-accent);
      color: var(--demo-on-accent);
      font: inherit;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 2px solid var(--djs-focus, var(--demo-accent));
      outline-offset: 2px;
    }
    .muted {
      color: var(--demo-muted);
      font-size: 0.875rem;
    }
  `;

  declare added: number;
  declare hydrated: boolean;

  constructor() {
    super();
    // Set here, not as class fields: a field would hide the property Lit defines.
    this.added = 0;
    this.hydrated = false;
  }

  // Runs in the browser only, once the server's shadow root is adopted. The
  // change waits for that update to finish: Lit warns of one made during it.
  override firstUpdated() {
    void this.updateComplete.then(() => (this.hydrated = true));
  }

  override render() {
    // What the server load returned. Always the value: the renderer waits for it.
    const { framework, start } = this.data;
    return html`
      <section data-hydrated=${String(this.hydrated)}>
        <p class="row"><span class="tag">counter · ${framework}</span></p>
        <p class="row">
          <output aria-live="polite">${start + this.added}</output>
          <button type="button" @click=${() => (this.added += 1)}>Add one</button>
        </p>
        <p class="muted">
          ${this.hydrated ? `Hydrated: ${framework} runs the button in this tab.` : `Server HTML: the button works once ${framework} hydrates.`}
        </p>
      </section>
    `;
  }
}

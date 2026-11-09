import { css, html } from "lit";
import { DropletElement } from "@dropletsjs/renderer-lit/element";
import { enhance } from "@dropletsjs/renderer-lit/form";
import { cardStyles } from "../../lib/Card.lit.ts";
import type { DropletActions, DropletProps } from "./$types";

export const ssr = true;
export const hydrate = true;

/**
 * Two forms in a shadow root, both posting to the default action of
 * +droplet.server.ts. `enhanced` opts in with `enhance()`: the submit goes
 * by fetch and the droplet renders again with `form`, in place. `plain`
 * posts as any form does, JavaScript or not.
 */
export default class Guestbook extends DropletElement<DropletProps> {
  static override styles = [
    cardStyles,
    css`
      form {
        display: flex;
        gap: 0.5rem;
        margin-top: 0.75rem;
      }
      input {
        flex: 1;
        border: 1px solid #cbd5e1;
        border-radius: 0.5rem;
        padding: 0.375rem 0.5rem;
        font: inherit;
      }
    `,
  ];

  override render() {
    return html`
      <section class="card" data-testid="guestbook">
        <header class="card-head">
          <span class="card-framework">Lit</span>
          <h2 class="card-title">guestbook</h2>
        </header>
        <p class="card-summary">A form action, from a form in the shadow root.</p>
        <p class="card-greeting" data-testid="form-result">${this.form?.message ?? "Nobody signed yet."}</p>
        <form method="post" action=${this.actionUrl()} data-testid="enhanced" ${enhance<DropletActions>()}>
          <input name="name" placeholder="Your name" aria-label="Your name (enhanced)" />
          <button type="submit">Sign</button>
        </form>
        <form method="post" action=${this.actionUrl()} data-testid="plain">
          <input name="name" placeholder="Your name" aria-label="Your name (plain)" />
          <button type="submit">Sign without JavaScript</button>
        </form>
      </section>
    `;
  }
}

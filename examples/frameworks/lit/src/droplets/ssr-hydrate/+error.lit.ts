import { html } from "lit";
import { DropletErrorElement } from "@dropletsjs/renderer-lit/element";
import { cardStyles } from "../../lib/Card.lit.ts";
// `error` is what handleError in +droplet.server.ts returns.
import type { DropletErrorProps } from "./$types";

// Its styles travel with its markup, in the declarative shadow root.
export default class SsrHydrateError extends DropletErrorElement<DropletErrorProps> {
  static override styles = cardStyles;

  override render() {
    return html`
      <section class="card" data-testid="error-page">
        <p class="card-error">Oops</p>
        <p class="card-summary">${this.error.message}</p>
      </section>
    `;
  }
}

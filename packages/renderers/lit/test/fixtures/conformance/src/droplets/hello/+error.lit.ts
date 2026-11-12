import { css, html } from "lit";
import { DropletErrorElement } from "@dropletsjs/renderer-lit/element";

export default class HelloError extends DropletErrorElement<{ error: { message: string } }> {
  static override styles = css`.oops { color: crimson; }`;

  override render() {
    return html`<p class="oops" data-testid="error">${this.error.message}</p>
      <div data-testid="error-children"><slot></slot></div>`;
  }
}

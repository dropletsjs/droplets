import { html } from "lit";
import { DropletErrorElement } from "@dropletsjs/renderer-lit/element";

export default class DocsError extends DropletErrorElement<{ error: { message: string } }> {
  override render() {
    return html`<p data-testid="docs-error">${this.error.message}</p>`;
  }
}

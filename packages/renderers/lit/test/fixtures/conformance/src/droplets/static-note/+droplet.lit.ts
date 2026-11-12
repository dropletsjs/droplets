import { css, html, LitElement } from "lit";

export const hydrate = false;

export default class StaticNote extends LitElement {
  static override styles = css`.note { font-style: italic; }`;

  override render() {
    return html`<p class="note">Rendered on the server only.</p>`;
  }
}

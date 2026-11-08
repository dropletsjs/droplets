import { css, html, LitElement } from "lit";

export default class HelloError extends LitElement {
  static override properties = { error: { attribute: false } };
  static override styles = css`p { color: rgb(4, 5, 6); }`;
  declare error: { message: string };

  override render() {
    return html`<p data-testid="error">${this.error.message}</p>`;
  }
}

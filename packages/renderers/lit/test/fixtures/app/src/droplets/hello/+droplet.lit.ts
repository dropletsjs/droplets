import { css, html, LitElement } from "lit";

export const prerender = false;

// A plain LitElement, declaring the properties the renderer sets itself.
export default class Hello extends LitElement {
  static override properties = { data: { attribute: false }, form: { attribute: false }, actionUrl: { attribute: false } };
  static override styles = css`h1 { color: rgb(1, 2, 3); }`;
  declare data: { greeting: string };
  declare form: { message: string } | undefined;
  declare actionUrl: (name?: string) => string;

  override render() {
    return html`<h1 data-testid="greeting">${this.data.greeting}</h1>
      <form method="post" action=${this.actionUrl()} data-testid="sign"><p data-testid="form">${this.form?.message ?? "none"}</p></form>
      <div data-testid="children"><slot></slot></div>`;
  }
}

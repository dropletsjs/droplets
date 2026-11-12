import { html } from "lit";
import { DropletElement } from "@dropletsjs/renderer-lit/element";

export const ssr = true;
export const hydrate = true;

export default class Hello extends DropletElement<{ data: { greeting: string } }> {
  static override properties = { clicks: { state: true } };
  declare clicks: number;

  constructor() {
    super();
    this.clicks = 0;
  }

  override render() {
    return html`<section>
      <h1 data-testid="greeting">${this.data.greeting}</h1>
      <button data-testid="count" @click=${() => this.clicks++}>${this.clicks}</button>
      <div data-testid="children"><slot></slot></div>
    </section>`;
  }
}

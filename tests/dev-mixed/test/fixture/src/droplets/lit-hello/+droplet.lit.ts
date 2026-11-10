import { html } from "lit";
import { DropletElement } from "@dropletsjs/renderer-lit/element";

export const ssr = true;
export const hydrate = true;

export default class Hello extends DropletElement<{ data: { word: string } }> {
  static override properties = { count: { state: true }, hydrated: { state: true } };
  declare count: number;
  declare hydrated: boolean;

  constructor() {
    super();
    this.count = 0;
    this.hydrated = false;
  }

  override firstUpdated() {
    void this.updateComplete.then(() => (this.hydrated = true));
  }

  override render() {
    return html`
      <section data-testid="lit" data-hydrated=${String(this.hydrated)}>
        <p data-text>Lit greets the host</p>
        <p data-word>${this.data.word}</p>
        <button type="button" @click=${() => (this.count += 1)}>${this.count}</button>
      </section>
    `;
  }
}

import { html, LitElement } from "lit";

export const ssr = false;

export default class Frame extends LitElement {
  override render() {
    return html`<div data-testid="frame"><slot></slot></div>`;
  }
}

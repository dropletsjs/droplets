import { html, LitElement } from "lit";

// Client-only: the server leaves an empty element and the browser mounts.
export const ssr = false;

export default class Frame extends LitElement {
  override render() {
    return html`<div data-testid="frame"><slot></slot></div>`;
  }
}

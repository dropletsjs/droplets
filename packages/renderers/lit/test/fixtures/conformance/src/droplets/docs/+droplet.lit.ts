import { html } from "lit";
import { DropletElement } from "@dropletsjs/renderer-lit/element";

export const prerender = true;

export default class Docs extends DropletElement<{ data: { page: number } }> {
  override render() {
    return html`<article data-testid="docs"><h1>${`Page ${this.data.page}`}</h1><p>@HOST@</p></article>`;
  }
}

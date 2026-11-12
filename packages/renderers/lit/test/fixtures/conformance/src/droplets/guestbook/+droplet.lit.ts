import { html } from "lit";
import { DropletElement } from "@dropletsjs/renderer-lit/element";
import { enhance } from "@dropletsjs/renderer-lit/form";

export const prerender = true;

// What the last action returned, or its fail() data. `sign` and `leave`
// are enhanced; `plain` posts as any form does.
export default class Guestbook extends DropletElement<{ data: { count: number }; form?: { message: string } }> {
  override render() {
    return html`<form method="post" action=${this.actionUrl()} data-testid="sign" ${enhance()}>
        <input name="name" />
        <p data-testid="form">${this.form?.message ?? "none"}</p>
      </form>
      <form method="post" action=${this.actionUrl("leave")} data-testid="leave" ${enhance({ action: "leave" })}></form>
      <form method="post" action=${this.actionUrl("echo")} data-testid="plain"></form>`;
  }
}

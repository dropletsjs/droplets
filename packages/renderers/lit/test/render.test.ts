import type { ServerRenderContext } from "@dropletsjs/droplets";
import { css, html, LitElement } from "lit";
import { describe, expect, it } from "vitest";
import { renderComponent } from "../src/render.ts";

describe("the server render", () => {
  type ContextOfInput = { kind?: ServerRenderContext["kind"] };

  function contextOf({ kind = "droplet" }: ContextOfInput = {}): ServerRenderContext {
    return {
      droplet: "hello",
      kind,
      renderId: "abc123",
      actionUrl: (name) => `https://shop.test/droplets/hello${name ? `?/${name}` : ""}`,
    };
  }

  // Lit components are classes.
  class Hello extends LitElement {
    static override properties = { data: { attribute: false }, form: { attribute: false }, actionUrl: { attribute: false } };
    static override styles = css`h1 { color: teal; }`;
    declare data: { greeting: string };
    declare form: { message: string } | undefined;
    declare actionUrl: (name?: string) => string;
    override render() {
      return html`<h1>${this.data.greeting}</h1><p>${this.form?.message ?? "none"}</p><form action=${this.actionUrl("add")}></form><slot></slot>`;
    }
  }

  class HelloError extends LitElement {
    static override properties = { error: { attribute: false } };
    declare error: { message: string };
    override render() {
      return html`<p>${this.error.message}</p>`;
    }
  }

  type TextOfInput = { html: string };

  /** The markup without Lit's part comments. */
  function textOf({ html }: TextOfInput): string {
    return html.replace(/<!--[^>]*-->/g, "");
  }

  it("prints a deferred element with its shadow root as a declarative template, the marker in light DOM", async () => {
    const out = await renderComponent({
      module: { default: Hello },
      props: { data: { greeting: "Hi <b>Ana</b>" } },
      context: contextOf(),
      prefix: "test-lit",
    });
    expect(out).toMatch(
      /^<!--lit-part [^>]+--><!--lit-node 0--><test-lit-hello\s+defer-hydration><template shadowroot="open" shadowrootmode="open">/,
    );
    // Styles travel inside the shadow root.
    expect(out).toContain("<style>h1 { color: teal; }</style>");
    // Data is escaped, never markup.
    expect(textOf({ html: out })).toContain("<h1>Hi &lt;b&gt;Ana&lt;/b&gt;</h1><p>none</p>");
    expect(out).toContain('<form action="https://shop.test/droplets/hello?/add">');
    expect(out).toMatch(/<\/template><div data-droplet-children style="display: contents"><\/div><\/test-lit-hello><!--\/lit-part-->$/);
  });

  it("passes the form action's result as `form`", async () => {
    const out = await renderComponent({
      module: { default: Hello },
      props: { data: { greeting: "Hi" }, form: { message: "Thanks" } },
      context: contextOf(),
      prefix: "test-lit",
    });
    expect(textOf({ html: out })).toContain("<p>Thanks</p>");
  });

  it("renders an error page as its own element, with `error`", async () => {
    const out = await renderComponent({
      module: { default: HelloError },
      props: { error: { message: "Sorry" } },
      context: contextOf({ kind: "error" }),
      prefix: "test-lit",
    });
    expect(out).toContain("<test-lit-hello--error");
    expect(textOf({ html: out })).toContain("<p>Sorry</p>");
  });

  it("says what a component file must export", async () => {
    await expect(
      renderComponent({ module: { default: () => "<p>" }, props: { data: {} }, context: contextOf(), prefix: "test-lit" }),
    ).rejects.toThrow(/must default-export a LitElement class/);
    await expect(renderComponent({ module: {}, props: { data: {} }, context: contextOf(), prefix: "test-lit" })).rejects.toThrow(
      /LitElement class/,
    );
  });

  it("renders an edited class under a tag of its own, never redefining one", async () => {
    class Edited extends Hello {}
    const out = await renderComponent({
      module: { default: Edited },
      props: { data: { greeting: "Hi" } },
      context: contextOf(),
      prefix: "test-lit",
    });
    expect(out).toContain("<test-lit-hello--v2");
  });
});

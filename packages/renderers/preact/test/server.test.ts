import { h } from "preact";
import { describe, expect, it } from "vitest";
import { render } from "../src/server.ts";
import { Hello, MARKER, Oops, serverContext } from "./doubles.ts";

type FormProps = { data: string; form?: { message: string } };

describe("render()", () => {
  it("renders the component with data and the bare children marker", () => {
    const html = render({ default: Hello }, { data: { greeting: "Hello Ana!" } }, serverContext());
    expect(html).toBe(
      `<section><h1 data-testid="greeting">Hello Ana!</h1><button data-testid="count">0</button><div data-testid="children">${MARKER}</div></section>`,
    );
  });

  it("renders an error page with several roots, as plain HTML without a head", () => {
    const out = render({ default: Oops }, { error: { message: "Sorry" } }, serverContext({ kind: "error" }));
    expect(out).toBe(`<p data-testid="error">Sorry</p><div data-testid="error-children">${MARKER}</div>`);
  });

  it("passes `form` on, and escapes what the loads return", () => {
    const Form = ({ data, form }: FormProps) => h("p", null, `${data} ${form?.message ?? "none"}`);
    expect(render({ default: Form }, { data: "<b>&</b>", form: { message: "ok" } }, serverContext())).toBe("<p>&lt;b>&amp;&lt;/b> ok</p>");
  });

  it("refuses a module without a component", () => {
    expect(() => render({ default: 42 }, { data: {} }, serverContext())).toThrow(/not a Preact component/);
    expect(() => render({}, { data: {} }, serverContext())).toThrow(/not a Preact component/);
  });
});

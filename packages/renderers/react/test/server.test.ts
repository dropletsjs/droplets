import { describe, expect, it } from "vitest";
import { render } from "../src/server.ts";
import { Hello, Oops, serverContext } from "./doubles.ts";

describe("render()", () => {
  it("renders the component with data and the bare children marker", () => {
    const html = render({ default: Hello }, { data: { greeting: "Hello Ana!" } }, serverContext());
    expect(html).toBe(
      `<section><h1 data-testid="greeting">Hello Ana!</h1><button data-testid="count">0</button><div data-testid="children"><div data-droplet-children="" style="display:contents"></div></div></section>`,
    );
  });

  it("renders an error page with several roots, as plain HTML without a head", () => {
    const out = render({ default: Oops }, { error: { message: "Sorry" } }, serverContext({ kind: "error" }));
    expect(out).toBe(
      `<p data-testid="error">Sorry</p><div data-testid="error-children"><div data-droplet-children="" style="display:contents"></div></div>`,
    );
  });

  it("escapes what the loads return", () => {
    const html = render({ default: Hello }, { data: { greeting: "<b>&</b>" } }, serverContext());
    expect(html).toContain("&lt;b&gt;&amp;&lt;/b&gt;");
  });

  it("refuses a module without a component", () => {
    expect(() => render({ default: 42 }, { data: {} }, serverContext())).toThrow(/not a React component/);
    expect(() => render({}, { data: {} }, serverContext())).toThrow(/not a React component/);
  });
});

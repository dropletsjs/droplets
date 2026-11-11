import { describe, expect, it } from "vitest";
import { escape as solidEscape, ssr, ssrHydrationKey } from "solid-js/web";
import { render } from "../src/server.ts";

// `+droplet.tsx` as `vite-plugin-solid` compiles it for the server:
// <section><h1 data-testid="greeting">{props.data.greeting}</h1><div data-testid="children">{props.children}</div></section>
const hello = {
  default: (props: { data: { greeting: string }; children?: unknown }) =>
    ssr(
      ["<section", '><h1 data-testid="greeting">', '</h1><div data-testid="children">', "</div></section>"],
      ssrHydrationKey(),
      solidEscape(props.data.greeting),
      solidEscape(props.children as string),
    ),
};

// `+error.tsx`, with two root elements: <p>{error.message}</p><div>{children}</div>
const oops = {
  default: (props: { error: { message: string }; children?: unknown }) => [
    ssr(["<p", ">", "</p>"], ssrHydrationKey(), solidEscape(props.error.message)),
    ssr(["<div", ">", "</div>"], ssrHydrationKey(), solidEscape(props.children as string)),
  ],
};

const actionUrl = (name?: string) => `https://drops.test/droplets/hello${name ? `?/${name}` : ""}`;
const context = (renderId: string, kind: "droplet" | "error" = "droplet") => ({ droplet: "hello", kind, renderId, actionUrl });

describe("render()", () => {
  it("renders the children marker exactly, without hydration attributes on it", () => {
    const html = render(hello, { data: { greeting: "Hello Ana!" } }, context("r1"));
    expect(html).toContain('<h1 data-testid="greeting">Hello Ana!</h1>');
    expect(html).toContain('<div data-testid="children"><div data-droplet-children style="display: contents"></div></div>');
    expect(html.match(/data-droplet-children/g)).toHaveLength(1);
  });

  it("keys the hydration ids by core's renderId, so droplets on one page never share keys", () => {
    const one = render(hello, { data: { greeting: "one" } }, context("abc123"));
    const two = render(hello, { data: { greeting: "two" } }, context("xyz789"));
    // The component nests a hydration context under the root: `<renderId>0<n>`.
    expect(one).toMatch(/^<section data-hk="abc12300">/);
    expect(two).toMatch(/^<section data-hk="xyz78900">/);
  });

  it("renders an error page with several roots, each keyed", () => {
    const html = render(oops, { error: { message: "Sorry" } }, context("e1", "error"));
    expect(html).toBe('<p data-hk="e100">Sorry</p><div data-hk="e101"><div data-droplet-children style="display: contents"></div></div>');
  });

  it("escapes what the loads return", () => {
    const html = render(hello, { data: { greeting: "<b>&</b>" } }, context("r2"));
    expect(html).toContain("&lt;b>&amp;&lt;/b>");
  });

  it("refuses a module without a component", () => {
    expect(() => render({ default: 42 }, { data: {} }, context("r3"))).toThrow(/not a Solid component/);
  });
});

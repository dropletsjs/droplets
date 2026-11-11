import type { ServerRenderContext } from "@dropletsjs/droplets";
import type { Child } from "hono/jsx";
import { jsx as serverJsx } from "hono/jsx/jsx-runtime";
import { describe, expect, it } from "vitest";
import { render } from "../src/server.ts";

const serverContext: ServerRenderContext = {
  droplet: "hello",
  kind: "droplet",
  renderId: "r1",
  actionUrl: () => "/droplets/hello",
};
const MARKER = '<div data-droplet-children="" style="display: contents"></div>';

describe("the server module", () => {
  it("renders the component with the children marker", async () => {
    const Hello = ({ data, children }: { data: { who: string }; children?: Child }) =>
      serverJsx("section", { children: [serverJsx("h1", { children: `Hello ${data.who}!` }), children] });
    const html = await render({ default: Hello }, { data: { who: "Ana" } }, serverContext);
    expect(html).toBe(`<section><h1>Hello Ana!</h1>${MARKER}</section>`);
  });

  it("awaits async components", async () => {
    const Later = async ({ data }: { data: string }) => serverJsx("p", { children: await Promise.resolve(data) });
    expect(await render({ default: Later }, { data: "soon" }, serverContext)).toBe("<p>soon</p>");
  });

  it("refuses a module whose default export is not a component", async () => {
    await expect(render({ default: "nope" }, { data: 1 }, serverContext)).rejects.toThrow(/not a Hono JSX component/);
  });
});

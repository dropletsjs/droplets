import { describe, expect, it } from "vitest";
import { render } from "../src/server.ts";
import { ErrorPage, Scoped, serverContext } from "./doubles.ts";

describe("render()", () => {
  it("renders the component with data and the bare children marker, unscoped", async () => {
    const html = await render({ default: Scoped }, { data: { greeting: "Hi" } }, serverContext());
    expect(html).toBe(
      `<section data-v-test><h1 data-v-test>Hi</h1><div class="kids" data-v-test><!--[--><div data-droplet-children style="display: contents"></div><!--]--></div></section>`,
    );
  });

  it("returns an error page's inlined styles as head", async () => {
    const out = await render({ default: ErrorPage }, { error: { message: "no" } }, serverContext({ kind: "error" }));
    expect(out).toEqual({ html: `<p class="oops">no</p>`, head: `<style>.oops{color:crimson}</style>` });
    // A droplet never gets a head.
    expect(await render({ default: ErrorPage }, { error: { message: "no" } }, serverContext())).toBe(`<p class="oops">no</p>`);
  });

  it("rejects a module without a component", async () => {
    await expect(render({}, { data: {} }, serverContext())).rejects.toThrow(/not a Vue component/);
  });
});

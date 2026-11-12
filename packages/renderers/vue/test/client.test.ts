// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { hydrate, mount, unmount } from "../src/client.ts";
import { render } from "../src/server.ts";
import { clientContext, ErrorPage, fakeHost, serverContext } from "./doubles.ts";

const injected = () => Array.from(document.head.querySelectorAll("style[data-droplet-vue]"));

describe("an error page in the browser", () => {
  it("moves the server's <style> into the document head before hydrating, once, and takes it out on unmount", async () => {
    expect(injected()).toHaveLength(0);
    const out = await render({ default: ErrorPage }, { error: { message: "no" } }, serverContext({ kind: "error" }));
    const page = typeof out === "string" ? out : `${out.head}${out.html}`;
    for (const _ of [1, 2]) {
      const target = document.createElement("div");
      target.innerHTML = page;
      document.body.appendChild(target);
      const p = target.querySelector("p");
      const app = hydrate({ default: ErrorPage }, target, { error: { message: "no" } }, clientContext({ host: fakeHost(), kind: "error" }));
      expect(target.querySelector("style")).toBeNull();
      expect(target.querySelector("p")).toBe(p);
      expect(injected()).toHaveLength(1);
      expect(injected()[0]?.textContent).toBe(".oops{color:crimson}");
      unmount(app);
      expect(injected()).toHaveLength(0);
    }
  });

  it("shares one <style> between the instances that use it, and removes it with the last of them", () => {
    const page = () => {
      const target = document.createElement("div");
      document.body.appendChild(target);
      return mount({ default: ErrorPage }, target, { error: { message: "no" } }, clientContext({ host: fakeHost(), kind: "error" }));
    };
    const first = page();
    const second = page();
    expect(injected()).toHaveLength(1);
    const style = injected()[0];
    unmount(first);
    // Still in use by the second: the same element stays.
    expect(injected()).toEqual([style]);
    unmount(second);
    expect(injected()).toHaveLength(0);
    // Unmounting twice takes nothing from anyone else.
    const third = page();
    unmount(second);
    expect(injected()).toHaveLength(1);
    unmount(third);
    expect(injected()).toHaveLength(0);
  });
});

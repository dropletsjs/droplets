// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { hydrate, mount, unmount } from "../src/client.ts";
import { render } from "../src/server.ts";
import { clientContext, ErrorPage, fakeHost, serverContext } from "./doubles.ts";

describe("an error page in the browser", () => {
  it("moves the server's <style> into the document head before hydrating, once", async () => {
    const before = document.head.querySelectorAll("style[data-droplets-vue]").length;
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
      unmount(app);
    }
    // Mounting in the browser injects the same CSS: still once.
    const target = document.createElement("div");
    document.body.appendChild(target);
    unmount(mount({ default: ErrorPage }, target, { error: { message: "no" } }, clientContext({ host: fakeHost(), kind: "error" })));
    const styles = Array.from(document.head.querySelectorAll("style[data-droplets-vue]"));
    expect(styles.length - before).toBe(1);
    expect(styles.at(-1)?.textContent).toBe(".oops{color:crimson}");
  });
});

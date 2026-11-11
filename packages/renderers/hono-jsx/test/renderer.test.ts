import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateRenderers } from "@dropletsjs/droplets";
import { readExportedFlags } from "@dropletsjs/droplets/vite";
import type { ClientRenderContext, DropletChildrenHost, ServerRenderContext } from "@dropletsjs/droplets";
import { use, useState, type Child } from "hono/jsx/dom";
import { Fragment, jsx as domJsx } from "hono/jsx/dom/jsx-runtime";
import { jsx as serverJsx } from "hono/jsx/jsx-runtime";
import type { Plugin } from "vite";
import { honoJsx } from "../src/index.ts";
import { honoJsxPlugin } from "../src/plugin.ts";
import { render } from "../src/server.ts";
import { hydrate, mount, unmount } from "../src/client.ts";

describe("honoJsx()", () => {
  it("claims .tsx and .jsx, owns hono/jsx (not hono) and points at its built modules", () => {
    const renderer = honoJsx();
    expect(renderer.name).toBe("hono-jsx");
    expect(renderer.extensions).toEqual([".tsx", ".jsx"]);
    expect(validateRenderers([renderer]).get(".tsx")).toEqual([renderer]);
    expect(renderer.packages).toEqual(["hono/jsx", "@dropletsjs/renderer-hono-jsx"]);
    expect(renderer.componentTypes).toBe("@dropletsjs/renderer-hono-jsx");
    expect(renderer.server).toMatch(/[\\/]dist[\\/]server\.js$/);
    expect(renderer.client).toMatch(/[\\/]dist[\\/]client\.js$/);
    expect(existsSync(renderer.server), "build the package first").toBe(true);
    expect(existsSync(renderer.client)).toBe(true);
    expect((renderer.plugins as (scope: object) => unknown[])({})).toHaveLength(1);
  });

  it("leaves the Vite plugin out when asked", () => {
    expect(honoJsx({ plugin: false }).plugins).toBeUndefined();
  });

  it("reads flags from the component's named exports with the default reader", () => {
    const source = `import { useState } from "hono/jsx";\nexport const ssr = false;\nexport default () => <p />;\n`;
    expect(readExportedFlags(source, "x", "tsx")).toEqual({ ssr: false });
    expect(honoJsx().readFlags).toBeUndefined();
  });
});

type Hook = (this: unknown, ...args: unknown[]) => Promise<unknown>;
const handlerOf = (hook: Plugin["transform"] | Plugin["resolveId"]): Hook =>
  (typeof hook === "function" ? hook : (hook as { handler: Hook }).handler) as Hook;
const inEnvironment = (consumer: "client" | "server") => ({ environment: { config: { consumer } } });

describe("the Vite plugin", () => {
  const source = `export default function Hi() { return <p class="x">hi</p>; }\n`;

  it("compiles for hono/jsx on the server and hono/jsx/dom in the browser", async () => {
    const transform = handlerOf(honoJsxPlugin().transform);
    const server = (await transform.call(inEnvironment("server"), source, "/app/src/droplets/a/+droplet.tsx")) as { code: string };
    const browser = (await transform.call(inEnvironment("client"), source, "/app/src/droplets/a/+droplet.tsx")) as { code: string };
    expect(server.code).toContain(`from "hono/jsx/jsx-runtime"`);
    expect(browser.code).toContain(`from "hono/jsx/dom/jsx-runtime"`);
    expect(browser.code).not.toContain("<p");
  });

  it("leaves node_modules, other files and, when scoped, other renderers' modules alone", async () => {
    const transform = handlerOf(honoJsxPlugin(/[?&]droplets-renderer=hono-jsx(?:&|$)/).transform);
    const env = inEnvironment("client");
    expect(await transform.call(env, source, "/app/node_modules/x/index.tsx")).toBeNull();
    expect(await transform.call(env, "export const a = 1;", "/app/src/lib/a.ts")).toBeNull();
    expect(await transform.call(env, source, "/app/src/lib/B.tsx?droplets-renderer=react")).toBeNull();
    expect(await transform.call(env, source, "/app/src/lib/B.tsx?droplets-renderer=hono-jsx")).not.toBeNull();
  });

  it("resolves hono/jsx and its runtimes to their DOM builds in the browser only", async () => {
    const resolveId = handlerOf(honoJsxPlugin().resolveId);
    const asked: string[] = [];
    const context = (consumer: "client" | "server") => ({
      ...inEnvironment(consumer),
      resolve: async (id: string) => {
        asked.push(id);
        return { id: `/resolved/${id}` };
      },
    });
    expect(await resolveId.call(context("client"), "hono/jsx", "/a.tsx", {})).toEqual({ id: "/resolved/hono/jsx/dom" });
    expect(await resolveId.call(context("client"), "hono/jsx/jsx-runtime", "/a.tsx", {})).toEqual({
      id: "/resolved/hono/jsx/dom/jsx-runtime",
    });
    expect(await resolveId.call(context("server"), "hono/jsx", "/a.tsx", {})).toBeNull();
    expect(await resolveId.call(context("client"), "hono", "/a.tsx", {})).toBeNull();
    expect(asked).toEqual(["hono/jsx/dom", "hono/jsx/dom/jsx-runtime"]);
  });
});

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

/** A host that records what the renderer asks of it. */
function host() {
  const calls: string[] = [];
  const children: DropletChildrenHost = {
    fill: (marker) => calls.push(`fill:${marker.isConnected || "later"}`),
    empty: (marker) => calls.push(`empty:${marker.isConnected}`),
  };
  return { calls, children };
}

const clientContext = (children: DropletChildrenHost, error?: ClientRenderContext["error"]): ClientRenderContext => ({
  droplet: "hello",
  kind: "droplet",
  renderId: "r1",
  children,
  markers: () => [],
  actionUrl: () => "/droplets/hello",
  ...(error ? { error } : {}),
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function target(html = ""): HTMLElement {
  const element = document.createElement("div");
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

describe("the client module", () => {
  /** `+droplet.tsx` as the fixture has it: the value, or a promise to `use`. */
  function Hello({ data, children }: { data: { greeting: string } | Promise<{ greeting: string }>; children?: Child }) {
    const [clicks, setClicks] = useState(0);
    const { greeting } = data instanceof Promise ? use(data) : data;
    return domJsx("section", {
      children: [
        domJsx("h1", { children: greeting }),
        domJsx("button", { onClick: () => setClicks((n) => n + 1), children: String(clicks) }),
        domJsx("div", { "data-testid": "children", children }),
      ],
    });
  }

  it("mounts, waits for data that is a promise, and fills the marker", async () => {
    const { calls, children } = host();
    const el = target();
    mount({ default: Hello }, el, { data: Promise.resolve({ greeting: "Hi" }) }, clientContext(children));
    await settle();
    expect(el.querySelector("h1")?.textContent).toBe("Hi");
    expect(el.querySelector("[data-testid=children] > [data-droplet-children]")).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^fill:/);
  });

  it("hydrates by rendering again in place of the server markup, in the same task", () => {
    const { children } = host();
    const el = target(`<section><h1>Hi</h1><button>0</button><div data-testid="children">${MARKER}</div></section>`);
    const old = el.querySelector("h1");
    hydrate({ default: Hello }, el, { data: { greeting: "Hi" } }, clientContext(children));
    expect(el.querySelector("h1")?.textContent).toBe("Hi");
    expect(el.querySelector("h1")).not.toBe(old);
    expect(el.querySelectorAll("[data-droplet-children]")).toHaveLength(1);
    el.querySelector("button")?.click();
  });

  it("empties the marker while it is still in the document when a branch drops it", async () => {
    const { calls, children } = host();
    let hide!: () => void;
    function Toggle({ children: kids }: { children?: Child }) {
      const [open, setOpen] = useState(true);
      hide = () => setOpen(false);
      return domJsx("section", { children: open ? domJsx("div", { children: kids }) : null });
    }
    const el = target();
    mount({ default: Toggle }, el, { data: undefined }, clientContext(children));
    hide();
    await settle();
    expect(el.querySelector("[data-droplet-children]")).toBeNull();
    expect(calls.at(-1)).toBe("empty:true");
  });

  it("shows the error page with what handleError made of a rejected data, and nothing unhandled", async () => {
    const { children } = host();
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", record);
    try {
      const Oops = ({ error }: { error: { message: string } }) => domJsx("p", { "data-testid": "error", children: error.message });
      const handled: unknown[] = [];
      const el = target();
      const data = Promise.reject({ status: 500 });
      mount({ default: Hello }, el, { data }, clientContext(children, {
        module: { default: Oops },
        handle: async (error) => {
          handled.push(error);
          return { message: "Sorry" };
        },
      }));
      await settle();
      expect(handled).toEqual([{ status: 500 }]);
      expect(el.querySelector("[data-testid=error]")?.textContent).toBe("Sorry");
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });

  it("renders nothing when handleError rejects", async () => {
    const { children } = host();
    const el = target();
    const Oops = () => domJsx("p", { children: "never" });
    mount({ default: Hello }, el, { data: Promise.reject(new Error("x")) }, clientContext(children, {
      module: { default: Oops },
      handle: () => Promise.reject(new Error("handler failed")),
    }));
    await settle();
    expect(el.textContent).toBe("");
  });

  it("unmounts", () => {
    const { children } = host();
    const el = target();
    const instance = mount({ default: () => domJsx(Fragment, { children: "here" }) }, el, { data: undefined }, clientContext(children));
    expect(el.textContent).toBe("here");
    unmount(instance);
    expect(el.textContent).toBe("");
  });
});

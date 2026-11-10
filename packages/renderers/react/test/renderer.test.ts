import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readExportedFlags, validateRenderers } from "@dropletsjs/droplets";
import type { ClientRenderContext, DropletChildrenHost, ServerRenderContext } from "@dropletsjs/droplets";
import { createElement, Fragment, StrictMode, useState, type ReactElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { react } from "../src/index.ts";
import { render } from "../src/server.ts";
import { hydrate, mount, unmount } from "../src/client.ts";

describe("react()", () => {
  it("claims .tsx and .jsx and points at its built modules", () => {
    const renderer = react();
    expect(renderer.name).toBe("react");
    expect(renderer.extensions).toEqual([".tsx", ".jsx"]);
    const byExtension = validateRenderers([renderer]);
    expect(byExtension.get(".tsx")).toEqual([renderer]);
    expect(byExtension.get(".jsx")).toEqual([renderer]);
    expect(renderer.server).toMatch(/[\\/]dist[\\/]server\.js$/);
    expect(renderer.client).toMatch(/[\\/]dist[\\/]client\.js$/);
    expect(renderer.clientSetup).toMatch(/[\\/]dist[\\/]client-setup\.js$/);
    expect(existsSync(renderer.server), "build the package first").toBe(true);
    expect(existsSync(renderer.client)).toBe(true);
    expect(existsSync(renderer.clientSetup!)).toBe(true);
    expect(renderer.packages).toEqual(["react", "react-dom", "@dropletsjs/renderer-react"]);
    // A function of core's scope: @vitejs/plugin-react's own array of
    // plugins, then the Fast Refresh that compiles React's modules alone.
    expect(typeof renderer.plugins).toBe("function");
    const plugins = (renderer.plugins as (scope: object) => unknown[])({});
    expect(plugins).toHaveLength(2);
    expect(Array.isArray(plugins[0])).toBe(true);
    expect((plugins[1] as { name: string }).name).toBe("droplets:react-refresh");
  });

  it("takes core's scope when Solid shares .tsx", () => {
    const plugins = (react().plugins as (scope: { include?: RegExp }) => unknown[])({ include: /x/ });
    expect(plugins).toHaveLength(2);
  });

  it("leaves the Vite plugin out when asked", () => {
    expect(react({ plugin: false }).plugins).toBeUndefined();
  });

  it("forwards plugin options", () => {
    // The plugin is opaque; what matters is that the options reach it without throwing.
    const plugins = react({ vitePlugin: { jsxImportSource: "react", exclude: [/\.solid\.tsx$/] } }).plugins;
    expect((plugins as (scope: object) => unknown[])({})).toHaveLength(2);
  });

  it("reads flags from the component's named exports with the default reader", () => {
    const source = `import { useState } from "react";\nexport const ssr = false;\nexport const prerender = true;\nexport default () => <p />;\n`;
    expect(readExportedFlags(source, "x")).toEqual({ ssr: false, prerender: true });
    expect(react().readFlags).toBeUndefined();
  });
});

const serverContext = (kind: ServerRenderContext["kind"] = "droplet"): ServerRenderContext => ({
  droplet: "hello",
  kind,
  renderId: "r1",
  actionUrl: () => "/droplets/hello",
});

/** `+droplet.tsx` as the fixture has it. */
function Hello({ data, children }: { data: { greeting: string }; children?: ReactNode }): ReactElement {
  const [clicks, setClicks] = useState(0);
  return createElement(
    "section",
    null,
    createElement("h1", { "data-testid": "greeting" }, data.greeting),
    createElement("button", { "data-testid": "count", onClick: () => setClicks((n) => n + 1) }, clicks),
    createElement("div", { "data-testid": "children" }, children),
  );
}

/** `+error.tsx` with two roots. */
function Oops({ error, children }: { error: { message: string }; children?: ReactNode }): ReactElement {
  return createElement(
    Fragment,
    null,
    createElement("p", { "data-testid": "error" }, error.message),
    createElement("div", { "data-testid": "error-children" }, children),
  );
}

describe("render()", () => {
  it("renders the component with data and the bare children marker", () => {
    const html = render({ default: Hello }, { data: { greeting: "Hello Ana!" } }, serverContext());
    expect(html).toBe(
      `<section><h1 data-testid="greeting">Hello Ana!</h1><button data-testid="count">0</button><div data-testid="children"><div data-droplet-children="" style="display:contents"></div></div></section>`,
    );
  });

  it("renders an error page with several roots, as plain HTML without a head", () => {
    const out = render({ default: Oops }, { error: { message: "Sorry" } }, serverContext("error"));
    expect(out).toBe(`<p data-testid="error">Sorry</p><div data-testid="error-children"><div data-droplet-children="" style="display:contents"></div></div>`);
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

function fakeHost() {
  return { fill: vi.fn<DropletChildrenHost["fill"]>(), empty: vi.fn<DropletChildrenHost["empty"]>() };
}

function clientContext(host: DropletChildrenHost, markers: Element[] = [], kind: ClientRenderContext["kind"] = "droplet") {
  return {
    droplet: "hello",
    kind,
    children: host,
    renderId: "r1",
    markers: () => markers,
    actionUrl: () => "/droplets/hello",
  } satisfies ClientRenderContext;
}

const q = (root: ParentNode, id: string) => root.querySelector(`[data-testid=${id}]`) as HTMLElement;

/** A click, and the microtask React flushes the resulting update in. */
const click = async (button: HTMLElement) => {
  button.click();
  await Promise.resolve();
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("mount()", () => {
  it("renders the marker in light DOM, fills it once committed, and empties it on unmount", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const host = fakeHost();
    const root = mount({ default: Hello }, target, { data: { greeting: "Hi" } }, clientContext(host));

    // Committed synchronously: the DOM is there when mount returns.
    const marker = target.querySelector<HTMLElement>("[data-testid=children] > [data-droplet-children]");
    expect(marker).not.toBeNull();
    expect(marker?.style.display).toBe("contents");
    expect(target.shadowRoot).toBeNull();
    expect(host.fill).toHaveBeenCalledTimes(1);
    expect(host.fill).toHaveBeenCalledWith(marker);
    expect(host.empty).not.toHaveBeenCalled();

    await click(q(target, "count"));
    expect(q(target, "count").textContent).toBe("1");

    unmount(root);
    expect(host.empty).toHaveBeenCalledTimes(1);
    expect(host.empty).toHaveBeenCalledWith(marker);
    expect(target.innerHTML).toBe("");
  });

  it("empties the marker while it is still in the DOM when a branch removes it, and fills the next one", () => {
    let toggle!: () => void;
    function Toggling({ children }: { data: unknown; children?: ReactNode }): ReactElement {
      const [show, setShow] = useState(true);
      toggle = () => setShow((s) => !s);
      return createElement("div", null, show ? children : null);
    }
    const target = document.createElement("div");
    document.body.appendChild(target);
    const host = fakeHost();
    const connected: boolean[] = [];
    host.empty.mockImplementation((marker) => connected.push(marker.isConnected));
    const root = mount({ default: Toggling }, target, { data: {} }, clientContext(host));
    const first = target.querySelector("[data-droplet-children]");
    expect(host.fill).toHaveBeenCalledWith(first);

    flushSync(toggle);
    expect(host.empty).toHaveBeenCalledWith(first);
    expect(connected).toEqual([true]);
    expect(target.querySelector("[data-droplet-children]")).toBeNull();

    flushSync(toggle);
    const second = target.querySelector("[data-droplet-children]");
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(host.fill).toHaveBeenLastCalledWith(second);
    unmount(root);
  });

  it("under StrictMode, the double effect fills, empties and fills again: never twice in a row", () => {
    const Strict = ({ data, children }: { data: { greeting: string }; children?: ReactNode }) =>
      createElement(StrictMode, null, createElement(Hello, { data, children }));
    const target = document.createElement("div");
    document.body.appendChild(target);
    const order: string[] = [];
    const host: DropletChildrenHost = { fill: () => order.push("fill"), empty: () => order.push("empty") };
    const root = mount({ default: Strict }, target, { data: { greeting: "Hi" } }, clientContext(host));
    expect(order.at(-1)).toBe("fill");
    for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
    unmount(root);
    expect(order.at(-1)).toBe("empty");
  });

  it("refuses a module without a component", () => {
    const target = document.createElement("div");
    expect(() => mount({ default: "nope" }, target, { data: {} }, clientContext(fakeHost()))).toThrow(/not a React component/);
  });
});

describe("hydrate()", () => {
  it("adopts the server nodes, the empty marker included, fills it once committed, and reports no error", async () => {
    const target = document.createElement("div");
    target.innerHTML = String(render({ default: Hello }, { data: { greeting: "Hi" } }, serverContext()));
    document.body.appendChild(target);
    // The element took the host's container out before hydrating: an empty marker.
    const serverMarker = target.querySelector("[data-droplet-children]")!;
    const order: string[] = [];
    const host: DropletChildrenHost = {
      fill: (marker) => order.push(`fill:${marker === serverMarker ? "same" : "other"}:${marker.isConnected}`),
      empty: (marker) => order.push(`empty:${marker === serverMarker ? "same" : "other"}:${marker.isConnected}`),
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const h1 = q(target, "greeting");
    const button = q(target, "count");

    const root = hydrate({ default: Hello }, target, { data: { greeting: "Hi" } }, clientContext(host, [serverMarker]));

    // The same node adopted and filled, nothing emptied.
    expect(order).toEqual(["fill:same:true"]);
    expect(q(target, "greeting")).toBe(h1);
    expect(q(target, "count")).toBe(button);
    expect(target.querySelector("[data-droplet-children]")).toBe(serverMarker);
    expect(target.querySelectorAll("[data-droplet-children]")).toHaveLength(1);
    // No mismatch, nothing recovered from.
    expect(error).not.toHaveBeenCalled();

    await click(button);
    expect(q(target, "count").textContent).toBe("1");
    expect(q(target, "count")).toBe(button);

    unmount(root);
    // Emptied before the marker left the DOM.
    expect(order.at(-1)).toBe("empty:same:true");
  });

  it("hydrates an error page with its two roots in place", () => {
    const target = document.createElement("div");
    target.innerHTML = String(render({ default: Oops }, { error: { message: "no" } }, serverContext("error")));
    document.body.appendChild(target);
    const p = q(target, "error");
    const marker = target.querySelector("[data-droplet-children]")!;
    const host = fakeHost();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const root = hydrate({ default: Oops }, target, { error: { message: "no" } }, clientContext(host, [marker], "error"));
    expect(q(target, "error")).toBe(p);
    expect(host.empty).not.toHaveBeenCalled();
    expect(host.fill).toHaveBeenCalledWith(marker);
    expect(error).not.toHaveBeenCalled();
    unmount(root);
  });

  it("reports a mismatch through console.error with the droplet's name, and recovers", () => {
    const target = document.createElement("div");
    target.innerHTML = `<section><h1 data-testid="greeting">Stale</h1><button data-testid="count">0</button><div data-testid="children"><div data-droplet-children="" style="display:contents"></div></div></section>`;
    document.body.appendChild(target);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const root = hydrate({ default: Hello }, target, { data: { greeting: "Fresh" } }, clientContext(fakeHost(), [target.querySelector("[data-droplet-children]")!]));
    expect(q(target, "greeting").textContent).toBe("Fresh");
    expect(error).toHaveBeenCalled();
    expect(error.mock.calls.some((call) => String(call[0]).includes("[droplets] hello (droplet, react)"))).toBe(true);
    unmount(root);
  });
});

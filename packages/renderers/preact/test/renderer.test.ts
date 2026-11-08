import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importsPackage, readExportedFlags, validateRenderers } from "@dropletsjs/droplets";
import type { ClientRenderContext, DropletChildrenHost, DropletRenderer, ServerRenderContext } from "@dropletsjs/droplets";
import { Fragment, h, type ComponentChildren, type VNode } from "preact";
import { useState } from "preact/hooks";
import type { Plugin } from "vite";
import { preact } from "../src/index.ts";
import { preactPlugin } from "../src/plugin.ts";
import { render } from "../src/server.ts";
import { hydrate, mount, unmount, type PreactInstance } from "../src/client.ts";

describe("preact()", () => {
  it("claims .tsx and .jsx, lists its packages and points at its built modules", () => {
    const renderer = preact();
    expect(renderer.name).toBe("preact");
    expect(renderer.extensions).toEqual([".tsx", ".jsx"]);
    const byExtension = validateRenderers([renderer]);
    expect(byExtension.get(".tsx")).toEqual([renderer]);
    expect(byExtension.get(".jsx")).toEqual([renderer]);
    expect(renderer.packages).toEqual(["preact", "preact-render-to-string", "@dropletsjs/renderer-preact"]);
    expect(renderer.componentTypes).toBe("@dropletsjs/renderer-preact");
    expect(renderer.server).toMatch(/[\\/]dist[\\/]server\.js$/);
    expect(renderer.client).toMatch(/[\\/]dist[\\/]client\.js$/);
    expect(existsSync(renderer.server), "build the package first").toBe(true);
    expect(existsSync(renderer.client)).toBe(true);
    expect(renderer.clientSetup).toBeUndefined();
    expect((renderer.plugins as (scope: object) => unknown[])({})).toHaveLength(1);
  });

  it("leaves the Vite plugin out when asked", () => {
    expect(preact({ plugin: false }).plugins).toBeUndefined();
  });

  it("reads flags from the component's named exports with the default reader", () => {
    const source = `import { useState } from "preact/hooks";\nexport const ssr = false;\nexport const prerender = true;\nexport default () => <p />;\n`;
    expect(readExportedFlags(source, "x")).toEqual({ ssr: false, prerender: true });
    expect(preact().readFlags).toBeUndefined();
  });

  it("shares .tsx with React: a component is Preact's when it imports preact or names it as its JSX source", () => {
    const react = { name: "react", extensions: [".tsx", ".jsx"], packages: ["react", "react-dom"], server: "s", client: "c" } satisfies DropletRenderer;
    const renderer = preact();
    const group = validateRenderers([react, renderer]).get(".tsx")!;
    expect(group).toEqual([react, renderer]);
    // Core gives a shared-extension component to the renderer whose package it names.
    const owner = (source: string) => group.filter((r) => (r.packages ?? []).some((pkg) => importsPackage(source, pkg))).map((r) => r.name);
    expect(owner(`import { useState } from "preact/hooks";`)).toEqual(["preact"]);
    expect(owner(`/** @jsxImportSource preact */\nexport default () => <p />;`)).toEqual(["preact"]);
    expect(owner(`import { useState } from "react";`)).toEqual(["react"]);
    // A preact-scoped library does not name preact.
    expect(owner(`import { signal } from "@preact/signals";`)).toEqual([]);
  });
});

type Hook = (this: unknown, ...args: unknown[]) => Promise<unknown>;
const handlerOf = (hook: Plugin["transform"]): Hook =>
  (typeof hook === "function" ? hook : (hook as { handler: Hook }).handler) as Hook;
const inEnvironment = (consumer: "client" | "server") => ({ environment: { config: { consumer } } });

describe("the Vite plugin", () => {
  const source = `export default function Hi() { return <p class="x">hi</p>; }\n`;

  it("compiles for preact/jsx-runtime, on the server and in the browser", async () => {
    const transform = handlerOf(preactPlugin().transform);
    for (const consumer of ["server", "client"] as const) {
      const out = (await transform.call(inEnvironment(consumer), source, "/app/src/droplets/a/+droplet.tsx")) as { code: string };
      expect(out.code).toContain(`from "preact/jsx-runtime"`);
      expect(out.code).not.toContain("<p");
      expect(out.code).not.toMatch(/["']react/);
    }
  });

  it("leaves node_modules, other files and, when scoped, other renderers' modules alone", async () => {
    const transform = handlerOf(preactPlugin(/[?&]droplets-renderer=preact(?:&|$)/).transform);
    const env = inEnvironment("client");
    expect(await transform.call(env, source, "/app/node_modules/x/index.tsx")).toBeNull();
    expect(await transform.call(env, "export const a = 1;", "/app/src/lib/a.ts")).toBeNull();
    expect(await transform.call(env, source, "/app/src/lib/B.tsx?droplets-renderer=react")).toBeNull();
    expect(await transform.call(env, source, "/app/src/lib/B.tsx")).toBeNull();
    expect(await transform.call(env, source, "/app/src/lib/B.tsx?droplets-renderer=preact")).not.toBeNull();
  });
});

const serverContext = (kind: ServerRenderContext["kind"] = "droplet"): ServerRenderContext => ({
  droplet: "hello",
  kind,
  renderId: "r1",
  actionUrl: () => "/droplets/hello",
});

const MARKER = `<div data-app-children style="display:contents;"></div>`;

/** `+droplet.tsx` as the fixture has it. */
function Hello({ data, children }: { data: { greeting: string }; children?: ComponentChildren }): VNode {
  const [clicks, setClicks] = useState(0);
  return h(
    "section",
    null,
    h("h1", { "data-testid": "greeting" }, data.greeting),
    h("button", { "data-testid": "count", onClick: () => setClicks((n) => n + 1) }, clicks),
    h("div", { "data-testid": "children" }, children),
  );
}

/** `+error.tsx` with two roots. */
function Oops({ error, children }: { error: { message: string }; children?: ComponentChildren }): VNode {
  return h(
    Fragment,
    null,
    h("p", { "data-testid": "error" }, error.message),
    h("div", { "data-testid": "error-children" }, children),
  );
}

describe("render()", () => {
  it("renders the component with data and the bare children marker", () => {
    const html = render({ default: Hello }, { data: { greeting: "Hello Ana!" } }, serverContext());
    expect(html).toBe(
      `<section><h1 data-testid="greeting">Hello Ana!</h1><button data-testid="count">0</button><div data-testid="children">${MARKER}</div></section>`,
    );
  });

  it("renders an error page with several roots, as plain HTML without a head", () => {
    const out = render({ default: Oops }, { error: { message: "Sorry" } }, serverContext("error"));
    expect(out).toBe(`<p data-testid="error">Sorry</p><div data-testid="error-children">${MARKER}</div>`);
  });

  it("passes `form` on, and escapes what the loads return", () => {
    const Form = ({ data, form }: { data: string; form?: { message: string } }) => h("p", null, `${data} ${form?.message ?? "none"}`);
    expect(render({ default: Form }, { data: "<b>&</b>", form: { message: "ok" } }, serverContext())).toBe("<p>&lt;b>&amp;&lt;/b> ok</p>");
  });

  it("refuses a module without a component", () => {
    expect(() => render({ default: 42 }, { data: {} }, serverContext())).toThrow(/not a Preact component/);
    expect(() => render({}, { data: {} }, serverContext())).toThrow(/not a Preact component/);
  });
});

function fakeHost() {
  return { fill: vi.fn<DropletChildrenHost["fill"]>(), empty: vi.fn<DropletChildrenHost["empty"]>() };
}

function clientContext(
  host: DropletChildrenHost,
  markers: Element[] = [],
  kind: ClientRenderContext["kind"] = "droplet",
  extra: Partial<ClientRenderContext> = {},
): ClientRenderContext {
  return {
    droplet: "hello",
    kind,
    children: host,
    renderId: "r1",
    markers: () => markers,
    actionUrl: () => "/droplets/hello",
    ...extra,
  };
}

const q = (root: ParentNode, id: string) => root.querySelector(`[data-testid=${id}]`) as HTMLElement;

/** Lets Preact's debounced re-render (and pending promises) run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const newTarget = () => {
  const target = document.createElement("div");
  document.body.appendChild(target);
  return target;
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("mount()", () => {
  it("renders the marker in light DOM, fills it once committed, and empties it on unmount", async () => {
    const target = newTarget();
    const host = fakeHost();
    const instance = mount({ default: Hello }, target, { data: { greeting: "Hi" } }, clientContext(host)) as PreactInstance;

    // Committed synchronously: the DOM is there when mount returns.
    const marker = target.querySelector<HTMLElement>("[data-testid=children] > [data-app-children]");
    expect(marker).not.toBeNull();
    expect(marker?.style.display).toBe("contents");
    expect(target.shadowRoot).toBeNull();
    expect(host.fill).toHaveBeenCalledTimes(1);
    expect(host.fill).toHaveBeenCalledWith(marker);
    expect(host.empty).not.toHaveBeenCalled();

    q(target, "count").click();
    await flush();
    expect(q(target, "count").textContent).toBe("1");

    const connected: boolean[] = [];
    host.empty.mockImplementation((m) => connected.push(m.isConnected));
    unmount(instance);
    expect(host.empty).toHaveBeenCalledWith(marker);
    expect(connected).toEqual([true]);
    expect(target.innerHTML).toBe("");
  });

  it("empties the marker while it is still in the DOM when a branch removes it, and fills the next one", async () => {
    let toggle!: () => void;
    function Toggling({ children }: { data: unknown; children?: ComponentChildren }): VNode {
      const [show, setShow] = useState(true);
      toggle = () => setShow((s) => !s);
      return h("div", null, show ? children : null);
    }
    const target = newTarget();
    const host = fakeHost();
    const connected: boolean[] = [];
    host.empty.mockImplementation((marker) => connected.push(marker.isConnected));
    const instance = mount({ default: Toggling }, target, { data: {} }, clientContext(host)) as PreactInstance;
    const first = target.querySelector("[data-app-children]");
    expect(host.fill).toHaveBeenCalledWith(first);

    toggle();
    await flush();
    expect(host.empty).toHaveBeenCalledWith(first);
    expect(connected).toEqual([true]);
    expect(target.querySelector("[data-app-children]")).toBeNull();

    toggle();
    await flush();
    const second = target.querySelector("[data-app-children]");
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(host.fill).toHaveBeenLastCalledWith(second);
    unmount(instance);
  });

  it("awaits a promise of data, then renders inside `rendering`", async () => {
    const target = newTarget();
    const host = fakeHost();
    let release!: (value: { greeting: string }) => void;
    const data = new Promise<{ greeting: string }>((resolve) => (release = resolve));
    const rendering = vi.fn((run: () => unknown) => run());
    const pending = mount({ default: Hello }, target, { data }, clientContext(host, [], "droplet", { rendering: rendering as ClientRenderContext["rendering"] }));
    expect(pending).toBeInstanceOf(Promise);
    await flush();
    expect(target.innerHTML).toBe("");

    release({ greeting: "Later" });
    const instance = await pending;
    expect(q(target, "greeting").textContent).toBe("Later");
    expect(rendering).toHaveBeenCalledTimes(1);
    expect(host.fill).toHaveBeenCalledTimes(1);
    unmount(instance);
  });

  it("shows the error page with what handleError made of a rejected data, or nothing when it rejects", async () => {
    const host = fakeHost();
    const handle = vi.fn(async (error: unknown) => ({ message: `handled ${(error as Error).message}` }));
    const target = newTarget();
    const context = clientContext(host, [], "droplet", { error: { module: { default: Oops }, handle } });
    await mount({ default: Hello }, target, { data: Promise.reject(new Error("down")) }, context);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(q(target, "error").textContent).toBe("handled down");
    expect(target.querySelector("[data-testid=error-children] > [data-app-children]")).not.toBeNull();
    expect(host.fill).toHaveBeenCalledTimes(1);

    const quiet = newTarget();
    const refused = clientContext(fakeHost(), [], "droplet", {
      error: { module: { default: Oops }, handle: () => Promise.reject(new Error("no")) },
    });
    await mount({ default: Hello }, quiet, { data: Promise.reject(new Error("down")) }, refused);
    expect(quiet.innerHTML).toBe("");
  });

  it("rejects with a rejected data when there is no error page", async () => {
    const target = newTarget();
    await expect(mount({ default: Hello }, target, { data: Promise.reject(new Error("down")) }, clientContext(fakeHost()))).rejects.toThrow("down");
    expect(target.innerHTML).toBe("");
  });

  it("puts the droplet under an error boundary when it has an error page", async () => {
    let explode!: () => void;
    function Fragile({ children }: { data: unknown; children?: ComponentChildren }): VNode<any> {
      const [broken, setBroken] = useState(false);
      explode = () => setBroken(true);
      if (broken) throw new Error("render failed");
      return h("div", { "data-testid": "fragile" }, children);
    }
    const target = newTarget();
    const handle = vi.fn(async () => ({ message: "Sorry" }));
    const host = fakeHost();
    const instance = mount({ default: Fragile }, target, { data: {} }, clientContext(host, [], "droplet", {
      error: { module: { default: Oops }, handle },
    })) as PreactInstance;
    expect(q(target, "fragile")).not.toBeNull();

    explode();
    await flush();
    await flush();
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ message: "render failed" }));
    expect(q(target, "fragile")).toBeNull();
    expect(q(target, "error").textContent).toBe("Sorry");
    expect(host.fill).toHaveBeenLastCalledWith(target.querySelector("[data-app-children]"));
    unmount(instance);
  });

  it("refuses a module without a component", () => {
    const target = document.createElement("div");
    expect(() => mount({ default: "nope" }, target, { data: {} }, clientContext(fakeHost()))).toThrow(/not a Preact component/);
  });
});

describe("hydrate()", () => {
  it("adopts the server nodes, the empty marker included, and fills it once committed", async () => {
    const target = newTarget();
    target.innerHTML = String(render({ default: Hello }, { data: { greeting: "Hi" } }, serverContext()));
    // The element took the host's container out before hydrating: an empty marker.
    const serverMarker = target.querySelector("[data-app-children]")!;
    const order: string[] = [];
    const host: DropletChildrenHost = {
      fill: (marker) => order.push(`fill:${marker === serverMarker ? "same" : "other"}:${marker.isConnected}`),
      empty: (marker) => order.push(`empty:${marker === serverMarker ? "same" : "other"}:${marker.isConnected}`),
    };
    const h1 = q(target, "greeting");
    const button = q(target, "count");

    const instance = hydrate({ default: Hello }, target, { data: { greeting: "Hi" } }, clientContext(host, [serverMarker]));

    // The same nodes adopted and the marker filled, nothing emptied.
    expect(order).toEqual(["fill:same:true"]);
    expect(q(target, "greeting")).toBe(h1);
    expect(q(target, "count")).toBe(button);
    expect(target.querySelector("[data-app-children]")).toBe(serverMarker);
    expect(target.querySelectorAll("[data-app-children]")).toHaveLength(1);

    button.click();
    await flush();
    expect(q(target, "count").textContent).toBe("1");
    expect(q(target, "count")).toBe(button);

    unmount(instance);
    // Emptied before the marker left the DOM.
    expect(order.at(-1)).toBe("empty:same:true");
    expect(target.innerHTML).toBe("");
  });

  it("hydrates an error page with its two roots in place", () => {
    const target = newTarget();
    target.innerHTML = String(render({ default: Oops }, { error: { message: "no" } }, serverContext("error")));
    const p = q(target, "error");
    const marker = target.querySelector("[data-app-children]")!;
    const host = fakeHost();
    const instance = hydrate({ default: Oops }, target, { error: { message: "no" } }, clientContext(host, [marker], "error"));
    expect(q(target, "error")).toBe(p);
    expect(host.empty).not.toHaveBeenCalled();
    expect(host.fill).toHaveBeenCalledWith(marker);
    unmount(instance);
  });
});

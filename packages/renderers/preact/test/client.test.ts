import type { ClientRenderContext, DropletChildrenHost } from "@dropletsjs/droplets";
import { type ComponentChild, type ComponentChildren, h, type VNode } from "preact";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrate, mount, type PreactInstance, unmount } from "../src/client.ts";
import { render } from "../src/server.ts";
import { byTestId, clientContext, fakeHost, flush, Hello, newTarget, Oops, serverContext } from "./doubles.ts";

type ChildrenProps = { data: unknown; children?: ComponentChildren };

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("mount()", () => {
  it("renders the marker in light DOM, fills it once committed, and empties it on unmount", async () => {
    const target = newTarget();
    const host = fakeHost();
    const instance = mount({ default: Hello }, target, { data: { greeting: "Hi" } }, clientContext({ host })) as PreactInstance;

    // Committed synchronously: the DOM is there when mount returns.
    const marker = target.querySelector<HTMLElement>("[data-testid=children] > [data-droplet-children]");
    expect(marker).not.toBeNull();
    expect(marker?.style.display).toBe("contents");
    expect(target.shadowRoot).toBeNull();
    expect(host.fill).toHaveBeenCalledTimes(1);
    expect(host.fill).toHaveBeenCalledWith(marker);
    expect(host.empty).not.toHaveBeenCalled();

    byTestId({ root: target, id: "count" }).click();
    await flush();
    expect(byTestId({ root: target, id: "count" }).textContent).toBe("1");

    const connected: boolean[] = [];
    host.empty.mockImplementation((m) => connected.push(m.isConnected));
    unmount(instance);
    expect(host.empty).toHaveBeenCalledWith(marker);
    expect(connected).toEqual([true]);
    expect(target.innerHTML).toBe("");
  });

  it("empties the marker while it is still in the DOM when a branch removes it, and fills the next one", async () => {
    let toggle = () => {};
    function Toggling({ children }: ChildrenProps): VNode {
      const [show, setShow] = useState(true);
      toggle = () => setShow((s) => !s);
      return h("div", null, show ? children : null);
    }
    const target = newTarget();
    const host = fakeHost();
    const connected: boolean[] = [];
    host.empty.mockImplementation((marker) => connected.push(marker.isConnected));
    const instance = mount({ default: Toggling }, target, { data: {} }, clientContext({ host })) as PreactInstance;
    const first = target.querySelector("[data-droplet-children]");
    expect(host.fill).toHaveBeenCalledWith(first);

    toggle();
    await flush();
    expect(host.empty).toHaveBeenCalledWith(first);
    expect(connected).toEqual([true]);
    expect(target.querySelector("[data-droplet-children]")).toBeNull();

    toggle();
    await flush();
    const second = target.querySelector("[data-droplet-children]");
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(host.fill).toHaveBeenLastCalledWith(second);
    unmount(instance);
  });

  it("awaits a promise of data, then renders inside `rendering`", async () => {
    const target = newTarget();
    const host = fakeHost();
    let release: (value: { greeting: string }) => void = () => {};
    const data = new Promise<{ greeting: string }>((resolve) => (release = resolve));
    const rendering = vi.fn((run: () => unknown) => run());
    const pending = mount(
      { default: Hello },
      target,
      { data },
      clientContext({ host, extra: { rendering: rendering as ClientRenderContext["rendering"] } }),
    );
    expect(pending).toBeInstanceOf(Promise);
    await flush();
    expect(target.innerHTML).toBe("");

    release({ greeting: "Later" });
    const instance = await pending;
    expect(byTestId({ root: target, id: "greeting" }).textContent).toBe("Later");
    expect(rendering).toHaveBeenCalledTimes(1);
    expect(host.fill).toHaveBeenCalledTimes(1);
    unmount(instance);
  });

  it("shows the error page with what handleError made of a rejected data, or nothing when it rejects", async () => {
    const host = fakeHost();
    const handle = vi.fn(async (error: unknown) => ({ message: `handled ${(error as Error).message}` }));
    const target = newTarget();
    const context = clientContext({ host, extra: { error: { module: { default: Oops }, handle } } });
    await mount({ default: Hello }, target, { data: Promise.reject(new Error("down")) }, context);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(byTestId({ root: target, id: "error" }).textContent).toBe("handled down");
    expect(target.querySelector("[data-testid=error-children] > [data-droplet-children]")).not.toBeNull();
    expect(host.fill).toHaveBeenCalledTimes(1);

    const quiet = newTarget();
    const refused = clientContext({
      host: fakeHost(),
      extra: { error: { module: { default: Oops }, handle: () => Promise.reject(new Error("no")) } },
    });
    await mount({ default: Hello }, quiet, { data: Promise.reject(new Error("down")) }, refused);
    expect(quiet.innerHTML).toBe("");
  });

  it("rejects with a rejected data when there is no error page", async () => {
    const target = newTarget();
    await expect(
      mount({ default: Hello }, target, { data: Promise.reject(new Error("down")) }, clientContext({ host: fakeHost() })),
    ).rejects.toThrow("down");
    expect(target.innerHTML).toBe("");
  });

  it("puts the droplet under an error boundary when it has an error page", async () => {
    let explode = () => {};
    function Fragile({ children }: ChildrenProps): ComponentChild {
      const [broken, setBroken] = useState(false);
      explode = () => setBroken(true);
      if (broken) throw new Error("render failed");
      return h("div", { "data-testid": "fragile" }, children);
    }
    const target = newTarget();
    const handle = vi.fn(async () => ({ message: "Sorry" }));
    const host = fakeHost();
    const instance = mount(
      { default: Fragile },
      target,
      { data: {} },
      clientContext({ host, extra: { error: { module: { default: Oops }, handle } } }),
    ) as PreactInstance;
    expect(byTestId({ root: target, id: "fragile" })).not.toBeNull();

    explode();
    await flush();
    await flush();
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ message: "render failed" }));
    expect(byTestId({ root: target, id: "fragile" })).toBeNull();
    expect(byTestId({ root: target, id: "error" }).textContent).toBe("Sorry");
    expect(host.fill).toHaveBeenLastCalledWith(target.querySelector("[data-droplet-children]"));
    unmount(instance);
  });

  it("refuses a module without a component", () => {
    const target = document.createElement("div");
    expect(() => mount({ default: "nope" }, target, { data: {} }, clientContext({ host: fakeHost() }))).toThrow(/not a Preact component/);
  });
});

describe("hydrate()", () => {
  it("adopts the server nodes, the empty marker included, and fills it once committed", async () => {
    const target = newTarget();
    target.innerHTML = String(render({ default: Hello }, { data: { greeting: "Hi" } }, serverContext()));
    // The element took the host's container out before hydrating: an empty marker.
    const serverMarker = target.querySelector("[data-droplet-children]") ?? expect.unreachable("the children marker");
    const order: string[] = [];
    const host: DropletChildrenHost = {
      fill: (marker) => order.push(`fill:${marker === serverMarker ? "same" : "other"}:${marker.isConnected}`),
      empty: (marker) => order.push(`empty:${marker === serverMarker ? "same" : "other"}:${marker.isConnected}`),
    };
    const h1 = byTestId({ root: target, id: "greeting" });
    const button = byTestId({ root: target, id: "count" });

    const instance = hydrate({ default: Hello }, target, { data: { greeting: "Hi" } }, clientContext({ host, markers: [serverMarker] }));

    // The same nodes adopted and the marker filled, nothing emptied.
    expect(order).toEqual(["fill:same:true"]);
    expect(byTestId({ root: target, id: "greeting" })).toBe(h1);
    expect(byTestId({ root: target, id: "count" })).toBe(button);
    expect(target.querySelector("[data-droplet-children]")).toBe(serverMarker);
    expect(target.querySelectorAll("[data-droplet-children]")).toHaveLength(1);

    button.click();
    await flush();
    expect(byTestId({ root: target, id: "count" }).textContent).toBe("1");
    expect(byTestId({ root: target, id: "count" })).toBe(button);

    unmount(instance);
    // Emptied before the marker left the DOM.
    expect(order.at(-1)).toBe("empty:same:true");
    expect(target.innerHTML).toBe("");
  });

  it("hydrates an error page with its two roots in place", () => {
    const target = newTarget();
    target.innerHTML = String(render({ default: Oops }, { error: { message: "no" } }, serverContext({ kind: "error" })));
    const p = byTestId({ root: target, id: "error" });
    const marker = target.querySelector("[data-droplet-children]") ?? expect.unreachable("the children marker");
    const host = fakeHost();
    const instance = hydrate(
      { default: Oops },
      target,
      { error: { message: "no" } },
      clientContext({ host, markers: [marker], kind: "error" }),
    );
    expect(byTestId({ root: target, id: "error" })).toBe(p);
    expect(host.empty).not.toHaveBeenCalled();
    expect(host.fill).toHaveBeenCalledWith(marker);
    unmount(instance);
  });
});

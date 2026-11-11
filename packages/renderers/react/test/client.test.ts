import type { DropletChildrenHost } from "@dropletsjs/droplets";
import { createElement, type ReactElement, type ReactNode, StrictMode, useState } from "react";
import { flushSync } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrate, mount, unmount } from "../src/client.ts";
import { render } from "../src/server.ts";
import { byTestId, clientContext, click, fakeHost, Hello, Oops, serverContext } from "./doubles.ts";

type TogglingProps = { data: unknown; children?: ReactNode };

type StrictProps = { data: { greeting: string }; children?: ReactNode };

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("mount()", () => {
  it("renders the marker in light DOM, fills it once committed, and empties it on unmount", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const host = fakeHost();
    const root = mount({ default: Hello }, target, { data: { greeting: "Hi" } }, clientContext({ host }));

    // Committed synchronously: the DOM is there when mount returns.
    const marker = target.querySelector<HTMLElement>("[data-testid=children] > [data-droplet-children]");
    expect(marker).not.toBeNull();
    expect(marker?.style.display).toBe("contents");
    expect(target.shadowRoot).toBeNull();
    expect(host.fill).toHaveBeenCalledTimes(1);
    expect(host.fill).toHaveBeenCalledWith(marker);
    expect(host.empty).not.toHaveBeenCalled();

    await click({ button: byTestId({ root: target, id: "count" }) });
    expect(byTestId({ root: target, id: "count" }).textContent).toBe("1");

    unmount(root);
    expect(host.empty).toHaveBeenCalledTimes(1);
    expect(host.empty).toHaveBeenCalledWith(marker);
    expect(target.innerHTML).toBe("");
  });

  it("empties the marker while it is still in the DOM when a branch removes it, and fills the next one", () => {
    let toggle = () => {};
    function Toggling({ children }: TogglingProps): ReactElement {
      const [show, setShow] = useState(true);
      toggle = () => setShow((s) => !s);
      return createElement("div", null, show ? children : null);
    }
    const target = document.createElement("div");
    document.body.appendChild(target);
    const host = fakeHost();
    const connected: boolean[] = [];
    host.empty.mockImplementation((marker) => connected.push(marker.isConnected));
    const root = mount({ default: Toggling }, target, { data: {} }, clientContext({ host }));
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
    const Strict = ({ data, children }: StrictProps) => createElement(StrictMode, null, createElement(Hello, { data, children }));
    const target = document.createElement("div");
    document.body.appendChild(target);
    const order: string[] = [];
    const host: DropletChildrenHost = { fill: () => order.push("fill"), empty: () => order.push("empty") };
    const root = mount({ default: Strict }, target, { data: { greeting: "Hi" } }, clientContext({ host }));
    expect(order.at(-1)).toBe("fill");
    for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
    unmount(root);
    expect(order.at(-1)).toBe("empty");
  });

  it("refuses a module without a component", () => {
    const target = document.createElement("div");
    expect(() => mount({ default: "nope" }, target, { data: {} }, clientContext({ host: fakeHost() }))).toThrow(/not a React component/);
  });
});

describe("hydrate()", () => {
  it("adopts the server nodes, the empty marker included, fills it once committed, and reports no error", async () => {
    const target = document.createElement("div");
    target.innerHTML = String(render({ default: Hello }, { data: { greeting: "Hi" } }, serverContext()));
    document.body.appendChild(target);
    // The element took the host's container out before hydrating: an empty marker.
    const serverMarker = target.querySelector("[data-droplet-children]") ?? expect.unreachable("the children marker");
    const order: string[] = [];
    const host: DropletChildrenHost = {
      fill: (marker) => order.push(`fill:${marker === serverMarker ? "same" : "other"}:${marker.isConnected}`),
      empty: (marker) => order.push(`empty:${marker === serverMarker ? "same" : "other"}:${marker.isConnected}`),
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const h1 = byTestId({ root: target, id: "greeting" });
    const button = byTestId({ root: target, id: "count" });

    const root = hydrate({ default: Hello }, target, { data: { greeting: "Hi" } }, clientContext({ host, markers: [serverMarker] }));

    // The same node adopted and filled, nothing emptied.
    expect(order).toEqual(["fill:same:true"]);
    expect(byTestId({ root: target, id: "greeting" })).toBe(h1);
    expect(byTestId({ root: target, id: "count" })).toBe(button);
    expect(target.querySelector("[data-droplet-children]")).toBe(serverMarker);
    expect(target.querySelectorAll("[data-droplet-children]")).toHaveLength(1);
    // No mismatch, nothing recovered from.
    expect(error).not.toHaveBeenCalled();

    await click({ button });
    expect(byTestId({ root: target, id: "count" }).textContent).toBe("1");
    expect(byTestId({ root: target, id: "count" })).toBe(button);

    unmount(root);
    // Emptied before the marker left the DOM.
    expect(order.at(-1)).toBe("empty:same:true");
  });

  it("hydrates an error page with its two roots in place", () => {
    const target = document.createElement("div");
    target.innerHTML = String(render({ default: Oops }, { error: { message: "no" } }, serverContext({ kind: "error" })));
    document.body.appendChild(target);
    const p = byTestId({ root: target, id: "error" });
    const marker = target.querySelector("[data-droplet-children]") ?? expect.unreachable("the children marker");
    const host = fakeHost();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const root = hydrate(
      { default: Oops },
      target,
      { error: { message: "no" } },
      clientContext({ host, markers: [marker], kind: "error" }),
    );
    expect(byTestId({ root: target, id: "error" })).toBe(p);
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
    const root = hydrate(
      { default: Hello },
      target,
      { data: { greeting: "Fresh" } },
      clientContext({
        host: fakeHost(),
        markers: [target.querySelector("[data-droplet-children]") ?? expect.unreachable("the children marker")],
      }),
    );
    expect(byTestId({ root: target, id: "greeting" }).textContent).toBe("Fresh");
    expect(error).toHaveBeenCalled();
    expect(error.mock.calls.some((call) => String(call[0]).includes("[droplets] hello (droplet, react)"))).toBe(true);
    unmount(root);
  });
});

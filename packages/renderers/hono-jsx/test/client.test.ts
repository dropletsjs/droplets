import type { ClientRenderContext, DropletChildrenHost } from "@dropletsjs/droplets";
import { use, useState, type Child } from "hono/jsx/dom";
import { Fragment, jsx as domJsx } from "hono/jsx/dom/jsx-runtime";
import { describe, expect, it } from "vitest";
import { hydrate, mount, unmount } from "../src/client.ts";

const MARKER = '<div data-droplet-children="" style="display: contents"></div>';

type RecordingHost = { calls: string[]; children: DropletChildrenHost };

/** A host that records what the renderer asks of it. */
function host(): RecordingHost {
  const calls: string[] = [];
  const children: DropletChildrenHost = {
    fill: (marker) => calls.push(`fill:${marker.isConnected || "later"}`),
    empty: (marker) => calls.push(`empty:${marker.isConnected}`),
  };
  return { calls, children };
}

type ClientContextInput = { children: DropletChildrenHost; error?: ClientRenderContext["error"] };

function clientContext({ children, error }: ClientContextInput): ClientRenderContext {
  return {
    droplet: "hello",
    kind: "droplet",
    renderId: "r1",
    children,
    markers: () => [],
    actionUrl: () => "/droplets/hello",
    ...(error ? { error } : {}),
  };
}

function settle(): Promise<unknown> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

type TargetInput = { html?: string };

function target({ html = "" }: TargetInput = {}): HTMLElement {
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
    mount({ default: Hello }, el, { data: Promise.resolve({ greeting: "Hi" }) }, clientContext({ children }));
    await settle();
    expect(el.querySelector("h1")?.textContent).toBe("Hi");
    expect(el.querySelector("[data-testid=children] > [data-droplet-children]")).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^fill:/);
  });

  it("hydrates by rendering again in place of the server markup, in the same task", () => {
    const { children } = host();
    const el = target({ html: `<section><h1>Hi</h1><button>0</button><div data-testid="children">${MARKER}</div></section>` });
    const old = el.querySelector("h1");
    hydrate({ default: Hello }, el, { data: { greeting: "Hi" } }, clientContext({ children }));
    expect(el.querySelector("h1")?.textContent).toBe("Hi");
    expect(el.querySelector("h1")).not.toBe(old);
    expect(el.querySelectorAll("[data-droplet-children]")).toHaveLength(1);
    el.querySelector("button")?.click();
  });

  it("empties the marker while it is still in the document when a branch drops it", async () => {
    const { calls, children } = host();
    let hide = (): void => undefined;
    function Toggle({ children: kids }: { children?: Child }) {
      const [open, setOpen] = useState(true);
      hide = () => setOpen(false);
      return domJsx("section", { children: open ? domJsx("div", { children: kids }) : null });
    }
    const el = target();
    mount({ default: Toggle }, el, { data: undefined }, clientContext({ children }));
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
      mount(
        { default: Hello },
        el,
        { data },
        clientContext({
          children,
          error: {
            module: { default: Oops },
            handle: async (error) => {
              handled.push(error);
              return { message: "Sorry" };
            },
          },
        }),
      );
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
    mount(
      { default: Hello },
      el,
      { data: Promise.reject(new Error("x")) },
      clientContext({
        children,
        error: {
          module: { default: Oops },
          handle: () => Promise.reject(new Error("handler failed")),
        },
      }),
    );
    await settle();
    expect(el.textContent).toBe("");
  });

  it("unmounts", () => {
    const { children } = host();
    const el = target();
    const instance = mount({ default: () => domJsx(Fragment, { children: "here" }) }, el, { data: undefined }, clientContext({ children }));
    expect(el.textContent).toBe("here");
    unmount(instance);
    expect(el.textContent).toBe("");
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { delegateEvents, getNextElement, insert, runHydrationEvents, template } from "solid-js/web";
import type { ClientRenderContext, DropletChildrenHost } from "@dropletsjs/droplets";
import { hydrate, mount, unmount } from "../src/client.ts";

// `+droplet.tsx` as `vite-plugin-solid` compiles it for the browser (hydratable):
// <section><h1 data-testid="greeting">{props.data.greeting}</h1>
//   <button data-testid="count" onClick={...}>{clicks()}</button>
//   <div data-testid="children">{props.children}</div></section>
const tmpl = template(
  `<section><h1 data-testid="greeting"></h1><button data-testid="count"></button><div data-testid="children"></div></section>`,
);
type Delegated = Element & { $$click?: () => void };
const hello = {
  default: (props: { data: { greeting: string }; children?: unknown }) => {
    const [clicks, setClicks] = createSignal(0);
    const section = getNextElement(tmpl);
    const h1 = section.firstChild as Element;
    const button = h1.nextSibling as Delegated;
    const div = button.nextSibling as Element;
    insert(h1, () => props.data.greeting);
    button.$$click = () => setClicks(clicks() + 1);
    insert(button, clicks);
    insert(div, () => props.children);
    runHydrationEvents();
    return section;
  },
};
delegateEvents(["click"]);

type ServerHtmlInput = { renderId: string; kid: string };

/**
 * What the server would have sent for `hello`, keyed by `renderId` (the
 * component nests a hydration context: `<renderId>0<n>`), with the empty
 * children marker: the element took the host's container out before hydrating.
 */
function serverHtml({ renderId, kid }: ServerHtmlInput): string {
  return (
    `<section data-hk="${renderId}00"><h1 data-testid="greeting">Hello ${kid}!</h1><button data-testid="count">0</button>` +
    `<div data-testid="children"><div data-droplet-children style="display: contents"></div></div></section>`
  );
}

type RecordingHost = DropletChildrenHost & { filled: Element[]; emptied: Array<[Element, boolean]> };

function host(): RecordingHost {
  const filled: Element[] = [];
  const emptied: Array<[Element, boolean]> = [];
  return { filled, emptied, fill: (marker) => filled.push(marker), empty: (marker) => emptied.push([marker, marker.isConnected]) };
}

type ContextForInput = { target: HTMLElement; renderId: string; children: DropletChildrenHost };

function contextFor({ target, renderId, children }: ContextForInput): ClientRenderContext {
  return {
    droplet: "hello",
    kind: "droplet",
    renderId,
    children,
    markers: () => Array.from(target.querySelectorAll("[data-droplet-children]")),
    actionUrl: (name) => `https://drops.test/droplets/hello${name ? `?/${name}` : ""}`,
  };
}

type ByTestIdInput = { root: ParentNode; id: string };

function byTestId({ root, id }: ByTestIdInput): HTMLElement {
  return root.querySelector<HTMLElement>(`[data-testid=${id}]`) ?? expect.unreachable(id);
}

function hydrationState(): { done?: boolean } | undefined {
  return (globalThis as { _$HY?: { done?: boolean } })._$HY;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("mount()", () => {
  it("renders the marker in light DOM, reports it to the host, and empties it on unmount", () => {
    const target = document.createElement("div");
    document.body.append(target);
    const children = host();
    const handle = mount(hello, target, { data: { greeting: "Hi" } }, contextFor({ target, renderId: "m1", children }));

    const marker = target.querySelector<HTMLElement>("[data-testid=children] > [data-droplet-children]");
    expect(marker).not.toBeNull();
    expect(marker?.style.display).toBe("contents");
    expect(target.shadowRoot).toBeNull();
    expect(children.filled).toEqual([marker]);
    expect(children.emptied).toEqual([]);

    byTestId({ root: target, id: "count" }).click();
    expect(byTestId({ root: target, id: "count" }).textContent).toBe("1");

    unmount(handle);
    // Emptied while the marker was still in the document.
    expect(children.emptied).toEqual([[marker, true]]);
    expect(target.innerHTML).toBe("");
  });

  it("empties the marker before Solid removes it when a <Show> turns false, and fills the next one", () => {
    const [show, setShow] = createSignal(true);
    const toggling = {
      default: (props: { data: unknown; children?: unknown }) => {
        const div = document.createElement("div");
        insert(div, () => (show() ? props.children : null));
        return div;
      },
    };
    const target = document.createElement("div");
    document.body.append(target);
    const children = host();
    const handle = mount(toggling, target, { data: {} }, contextFor({ target, renderId: "t1", children }));
    const first = target.querySelector("[data-droplet-children]") ?? expect.unreachable("the children marker");
    expect(children.filled).toEqual([first]);

    setShow(false);
    expect(children.emptied).toEqual([[first, true]]);
    expect(target.querySelector("[data-droplet-children]")).toBeNull();

    setShow(true);
    const second = target.querySelector("[data-droplet-children]") ?? expect.unreachable("the children marker");
    expect(second).not.toBe(first);
    expect(children.filled).toEqual([first, second]);
    unmount(handle);
  });
});

describe("hydrate()", () => {
  it("adopts the server markup and the server marker in place", () => {
    const target = document.createElement("div");
    target.innerHTML = serverHtml({ renderId: "h1x", kid: "kid-a" });
    document.body.append(target);
    const greeting = byTestId({ root: target, id: "greeting" });
    const marker = target.querySelector("[data-droplet-children]") ?? expect.unreachable("the children marker");
    const children = host();

    const handle = hydrate(hello, target, { data: { greeting: "Hello kid-a!" } }, contextFor({ target, renderId: "h1x", children }));

    expect(byTestId({ root: target, id: "greeting" })).toBe(greeting);
    expect(target.querySelector("[data-droplet-children]")).toBe(marker);
    expect(children.filled).toEqual([marker]);
    expect(target.querySelectorAll("[data-droplet-children]")).toHaveLength(1);

    byTestId({ root: target, id: "count" }).click();
    expect(byTestId({ root: target, id: "count" }).textContent).toBe("1");

    unmount(handle);
    expect(children.emptied).toEqual([[marker, true]]);
  });

  it("hydrates a second droplet in place after Solid marked the page's hydration done", () => {
    const first = document.createElement("div");
    first.innerHTML = serverHtml({ renderId: "aaa", kid: "kid-1" });
    const second = document.createElement("div");
    second.innerHTML = serverHtml({ renderId: "bbb", kid: "kid-2" });
    document.body.append(first, second);

    hydrate(hello, first, { data: { greeting: "Hello kid-1!" } }, contextFor({ target: first, renderId: "aaa", children: host() }));
    // The first event after a hydration: Solid flags hydration as done for the page.
    byTestId({ root: first, id: "count" }).click();
    expect(byTestId({ root: first, id: "count" }).textContent).toBe("1");
    expect(hydrationState()?.done).toBe(true);

    const greeting = byTestId({ root: second, id: "greeting" });
    const marker = second.querySelector("[data-droplet-children]") ?? expect.unreachable("the children marker");
    const children = host();
    hydrate(hello, second, { data: { greeting: "Hello kid-2!" } }, contextFor({ target: second, renderId: "bbb", children }));

    // Adopted, not re-rendered: the same nodes, keyed by its own renderId.
    expect(byTestId({ root: second, id: "greeting" })).toBe(greeting);
    expect(second.querySelector("[data-droplet-children]")).toBe(marker);
    expect(children.filled).toEqual([marker]);
    byTestId({ root: second, id: "count" }).click();
    expect(byTestId({ root: second, id: "count" }).textContent).toBe("1");
    // The first one is still alive on its own.
    byTestId({ root: first, id: "count" }).click();
    expect(byTestId({ root: first, id: "count" }).textContent).toBe("2");
  });

  it("keys hydration by renderId: another id's markup is not adopted", () => {
    const target = document.createElement("div");
    target.innerHTML = serverHtml({ renderId: "other", kid: "kid-x" });
    document.body.append(target);
    const greeting = byTestId({ root: target, id: "greeting" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      hydrate(hello, target, { data: { greeting: "Hello kid-x!" } }, contextFor({ target, renderId: "mine", children: host() }));
    } finally {
      warn.mockRestore();
    }
    expect(byTestId({ root: target, id: "greeting" })).not.toBe(greeting);
  });
});

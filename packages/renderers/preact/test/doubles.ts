import type { ClientRenderContext, DropletChildrenHost, ServerRenderContext } from "@dropletsjs/droplets";
import { type ComponentChildren, Fragment, h, type VNode } from "preact";
import { useState } from "preact/hooks";
import { type Mock, vi } from "vitest";

type ServerContextInput = { kind?: ServerRenderContext["kind"] };

type ClientContextInput = {
  host: DropletChildrenHost;
  markers?: Element[];
  kind?: ClientRenderContext["kind"];
  extra?: Partial<ClientRenderContext>;
};

type FakeHost = { fill: Mock<DropletChildrenHost["fill"]>; empty: Mock<DropletChildrenHost["empty"]> };

type HelloProps = { data: { greeting: string }; children?: ComponentChildren };

type OopsProps = { error: { message: string }; children?: ComponentChildren };

type ByTestIdInput = { root: ParentNode; id: string };

/** The children marker as `preact-render-to-string` writes it. */
export const MARKER = `<div data-droplet-children style="display:contents;"></div>`;

export function serverContext({ kind = "droplet" }: ServerContextInput = {}): ServerRenderContext {
  return { droplet: "hello", kind, renderId: "r1", actionUrl: () => "/droplets/hello" };
}

export function clientContext({ host, markers = [], kind = "droplet", extra = {} }: ClientContextInput): ClientRenderContext {
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

export function fakeHost(): FakeHost {
  return { fill: vi.fn<DropletChildrenHost["fill"]>(), empty: vi.fn<DropletChildrenHost["empty"]>() };
}

/** `+droplet.tsx` as the fixture has it. */
export function Hello({ data, children }: HelloProps): VNode {
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
export function Oops({ error, children }: OopsProps): VNode {
  return h(Fragment, null, h("p", { "data-testid": "error" }, error.message), h("div", { "data-testid": "error-children" }, children));
}

export function byTestId({ root, id }: ByTestIdInput): HTMLElement {
  return root.querySelector(`[data-testid=${id}]`) as HTMLElement;
}

/** Lets Preact's debounced re-render (and pending promises) run. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function newTarget(): HTMLDivElement {
  const target = document.createElement("div");
  document.body.appendChild(target);
  return target;
}

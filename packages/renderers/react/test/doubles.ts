import type { ClientRenderContext, DropletChildrenHost, ServerRenderContext } from "@dropletsjs/droplets";
import { createElement, Fragment, type ReactElement, type ReactNode, useState } from "react";
import { type Mock, vi } from "vitest";

type ServerContextInput = { kind?: ServerRenderContext["kind"] };

type ClientContextInput = { host: DropletChildrenHost; markers?: Element[]; kind?: ClientRenderContext["kind"] };

type FakeHost = { fill: Mock<DropletChildrenHost["fill"]>; empty: Mock<DropletChildrenHost["empty"]> };

type HelloProps = { data: { greeting: string }; children?: ReactNode };

type OopsProps = { error: { message: string }; children?: ReactNode };

type ByTestIdInput = { root: ParentNode; id: string };

type ClickInput = { button: HTMLElement };

export function serverContext({ kind = "droplet" }: ServerContextInput = {}): ServerRenderContext {
  return { droplet: "hello", kind, renderId: "r1", actionUrl: () => "/droplets/hello" };
}

export function clientContext({ host, markers = [], kind = "droplet" }: ClientContextInput): ClientRenderContext {
  return {
    droplet: "hello",
    kind,
    children: host,
    renderId: "r1",
    markers: () => markers,
    actionUrl: () => "/droplets/hello",
  };
}

export function fakeHost(): FakeHost {
  return { fill: vi.fn<DropletChildrenHost["fill"]>(), empty: vi.fn<DropletChildrenHost["empty"]>() };
}

/** `+droplet.tsx` as the fixture has it. */
export function Hello({ data, children }: HelloProps): ReactElement {
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
export function Oops({ error, children }: OopsProps): ReactElement {
  return createElement(
    Fragment,
    null,
    createElement("p", { "data-testid": "error" }, error.message),
    createElement("div", { "data-testid": "error-children" }, children),
  );
}

export function byTestId({ root, id }: ByTestIdInput): HTMLElement {
  return root.querySelector(`[data-testid=${id}]`) as HTMLElement;
}

/** A click, and the microtask React flushes the resulting update in. */
export async function click({ button }: ClickInput): Promise<void> {
  button.click();
  await Promise.resolve();
}

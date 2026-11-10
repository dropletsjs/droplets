/**
 * The `children` prop of a Preact droplet: a vnode that renders the children
 * marker, `<div data-droplet-children style="display: contents">`. Shared by the
 * server and the browser, so the trees match when hydrating; it imports only
 * `preact` and `preact/hooks`, so it is safe in the browser bundle.
 *
 * On the server there is no host and the output is the bare marker. In the
 * browser the element's children host arrives through context: once the
 * marker is committed, a layout effect reports it with `fill` (Preact sets
 * refs before it runs layout effects, within `render()`), and its cleanup
 * reports `empty` before the node goes away (a conditional branch closing,
 * `render(null, target)`): Preact runs a removed subtree's hook cleanups
 * before it detaches its DOM nodes. The effect depends on the host alone, so
 * a re-render never moves the children.
 */
import { createContext, h, type VNode } from "preact";
import { useContext, useLayoutEffect, useRef } from "preact/hooks";
import type { DropletChildrenHost } from "@dropletsjs/droplets";

/** Any element: a vnode's props type does not widen to `{}`. */
type AnyVNode = VNode<any>;

/** The element's children host, provided by the client module; `null` on the server. */
export const ChildrenHostContext = createContext<DropletChildrenHost | null>(null);

const MARKER_STYLE = { display: "contents" };

/** Renders the children marker. See the module documentation. */
export function DropletChildren(): AnyVNode {
  const host = useContext(ChildrenHostContext);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const marker = ref.current;
    if (!host || !marker) return;
    host.fill(marker);
    return () => host.empty(marker);
  }, [host]);
  return h("div", { "data-droplet-children": "", style: MARKER_STYLE, ref });
}

/** The `children` value handed to a component: one `<DropletChildren />`. */
export function childrenElement(): AnyVNode {
  return h(DropletChildren, {});
}

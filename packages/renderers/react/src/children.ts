/**
 * The `children` prop of a React droplet: a React element that renders the
 * children marker, `<div data-droplet-children style="display: contents">`.
 * Shared by the server and the browser, so the element trees match when
 * hydrating; it imports only `react`, so it is safe in the browser bundle.
 *
 * On the server there is no host and the output is the bare marker. In the
 * browser the element's children host arrives through context: once the
 * marker is committed, a layout effect reports it with `fill` and its
 * cleanup reports `empty` before the node goes away (a conditional branch
 * closing, `root.unmount()`): React runs layout-effect cleanups of a deleted
 * subtree before it detaches its host nodes. The effect depends on the host
 * alone, so a re-render never moves the children; StrictMode's double
 * effects only fill, empty and fill again, which the host handles.
 */
import { createContext, createElement, useContext, useLayoutEffect, useRef, type ReactElement } from "react";
import type { DropletChildrenHost } from "@dropletsjs/droplets";

/** The element's children host, provided by the client module; `null` on the server. */
export const ChildrenHostContext = createContext<DropletChildrenHost | null>(null);

/** Renders the children marker. See the module documentation. */
export function DropletChildren(): ReactElement {
  const host = useContext(ChildrenHostContext);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const marker = ref.current;
    if (!host || !marker) return;
    host.fill(marker);
    return () => host.empty(marker);
  }, [host]);
  return createElement("div", { "data-droplet-children": "", style: { display: "contents" }, ref });
}

/** The `children` value handed to a component: one `<DropletChildren />`. */
export function childrenElement(): ReactElement {
  return createElement(DropletChildren);
}

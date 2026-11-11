/**
 * What the marker in `children.svelte` does in the browser, and how it finds
 * the element's children host.
 *
 * The host arrives through Svelte's component context: `mount`/`hydrate`
 * set it at the root (`context: new Map([[CHILDREN_KEY, host]])`), and the
 * `use:fill` action reads it from inside the user's component, where the
 * snippet renders. Svelte 5 removes an effect's DOM before it runs
 * teardowns, so an action cleanup would come too late for `empty`: the
 * marker carries an out transition instead. Transitions run before the
 * removal, and `|global` makes it run when any ancestor block goes, not only
 * the marker's own. Zero duration: Svelte completes it synchronously.
 */
import type { DropletChildrenHost } from "@dropletsjs/droplets";
import { getContext } from "svelte";

type ReleaseHostInput = { host: DropletChildrenHost | undefined };

/** The context key the renderer provides the element's children host under. */
export const CHILDREN_KEY = Symbol.for("droplets:svelte:children");

/** The host each marker was filled from, for its release. */
const hosts = new WeakMap<Element, DropletChildrenHost>();
/** The marker each host last filled, for {@link releaseHost}. */
const lastMarkers = new WeakMap<DropletChildrenHost, Element>();

/** `use:fill`: the marker is in the DOM, the host's container goes in. */
export function fill(marker: Element): void {
  const host = getContext<DropletChildrenHost | undefined>(CHILDREN_KEY);
  if (!host) return;
  hosts.set(marker, host);
  lastMarkers.set(host, marker);
  host.fill(marker);
}

/** `out:release|global`: the marker is about to go, the container comes out first. */
export function release(marker: Element): { duration: number } {
  const host = hosts.get(marker);
  if (host && lastMarkers.get(host) === marker) lastMarkers.delete(host);
  host?.empty(marker);
  return { duration: 0 };
}

/**
 * The container out of the marker `host` last filled, ahead of a removal
 * that runs no transition: `<svelte:boundary>` destroys what failed without
 * out transitions, and only then calls anything of ours. Returns a function
 * that puts the container back if the marker is still there after all.
 */
export function releaseHost({ host }: ReleaseHostInput): () => void {
  const marker = host && lastMarkers.get(host);
  if (!host || !marker) return () => {};
  host.empty(marker);
  return () => {
    if (marker.isConnected) {
      lastMarkers.set(host, marker);
      host.fill(marker);
    }
  };
}

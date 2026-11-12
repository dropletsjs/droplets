/**
 * `droplets:stale`: the droplets server was deployed while the page stayed
 * open, so an answer comes from another build than the loader in the page.
 * The element reports it for a fragment and for `_data`, an enhanced form
 * for an action's answer; what happens next is the host's call.
 *
 * @module
 */

/**
 * Dispatched on a droplet element, bubbling up to `window`, when the page's
 * loader comes from another build than the server that answered: the
 * droplets server was deployed while the page stayed open. The element keeps
 * its server HTML and does not hydrate, an enhanced form applies nothing;
 * what happens next is the host's call, e.g.
 * `addEventListener("droplets:stale", () => location.reload())`.
 */
export type DropletStaleDetail = {
  /** The custom element name. */
  element: string;
  droplet: string;
  /** The build of the loader running in the page. */
  loaded: string;
  /** The build that served the droplet. */
  served: string;
};

export const STALE_EVENT = "droplets:stale";

export type ReportStaleInput = { element: Element; droplet: string; loaded: string; served: string };

/** Tells the page, from the element: `droplets:stale` bubbles out of it and through shadow roots. */
export function reportStale({ element, droplet, loaded, served }: ReportStaleInput): void {
  const detail: DropletStaleDetail = { element: element.localName, droplet, loaded, served };
  element.dispatchEvent(new CustomEvent(STALE_EVENT, { bubbles: true, composed: true, detail }));
}

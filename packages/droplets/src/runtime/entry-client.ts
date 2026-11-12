import {
  buildHash,
  dropletsById,
  dropletsHydrateById,
  dropletsScriptById,
  dropletsServerLoadById,
  dropletsStylesById,
  elementName,
} from "virtual:droplets";
import { serverKey, serverLocation } from "./server-records.ts";
import { installDevElement } from "./dev-element.ts";

/** Droplets that exist in this build. */
const dropletRegistry = new Set(Object.keys(dropletsById));
/** Droplets that want client-side JS, and when they hydrate. Mutated by HMR in dev. */
const hydrationRegistry = new Map(Object.entries(dropletsHydrateById));
/** Droplets with `+droplet.server.ts`: only they have `_data` to fetch. */
const serverLoadRegistry = new Set(Object.keys(dropletsServerLoadById));
/** Script droplets: browser code alone, so `data-droplet-hydrate="false"` never stops one. */
const scriptRegistry = new Set(Object.keys(dropletsScriptById));
/** Every stylesheet of each droplet that has any, relative to its server. Empty in dev. */
const styleRegistry = new Map(Object.entries(dropletsStylesById));

/** The page the droplet runs in, as `host`: its path and query, without the fragment (`#…`). */
function pageUrl(): string {
  const url = new URL(globalThis.location.href);
  url.hash = "";
  return url.href;
}

type FormResultHostInput = { host: string; droplet: string };

/** Whether `host` has a `__droplet_form_<droplet>_*` key: a result `_data` may answer with. */
function carriesFormResult({ host, droplet }: FormResultHostInput): boolean {
  try {
    const prefix = `${FORM_RESULT_PREFIX}${droplet}_`;
    return [...splitFormResults(new URL(host)).results.keys()].some((key) => key.startsWith(prefix));
  } catch {
    // A host that is no URL carries nothing.
    return false;
  }
}

/**
 * `host` with the page's own `__droplet_form_<droplet>_*` result added, when
 * the page's URL has one and `host` has none: the server verifies it.
 */
function withPageResult({ host, droplet }: FormResultHostInput): string {
  try {
    const prefix = `${FORM_RESULT_PREFIX}${droplet}_`;
    const own = [...splitFormResults(new URL(pageUrl())).results].filter(([key]) => key.startsWith(prefix));
    if (own.length === 0 || carriesFormResult({ host, droplet })) return host;
    const url = new URL(host);
    for (const [key, value] of own) url.searchParams.append(key, value);
    return url.href;
  } catch {
    // A host that is no URL goes back as it came: the server decides.
    return host;
  }
}

/**
 * Dispatched on a droplet element, bubbling up to `window`, when the page's
 * loader comes from another build than the server that rendered it: the
 * droplets server was deployed while the page stayed open. The element keeps
 * its server HTML and does not hydrate; what happens next is the host's call,
 * e.g. `addEventListener("droplets:stale", () => location.reload())`.
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

/** What the droplet was rendered with: where it renders, and its props. */
type WireContext = { host: string; props: Record<string, unknown> };

/**
 * What the server load produced, inline or from `_data`; from `_data`, with
 * the `form` of a no-JavaScript action the page's URL carried back.
 */
export type Payload = { data: unknown; form?: unknown; failed?: undefined } | { failed: true; error: unknown };

import type { DropletChildrenHost, HydrateMode } from "../renderer.ts";
export type { DropletHooksPayload, DropletUpdatePayload } from "./dev-element.ts";

/**
 * What the element hands a component for its `children`: the renderer
 * renders a `[data-droplet-children]` marker and calls back when it is in the
 * DOM and before it goes away. Defined with the renderer contract;
 * re-exported here.
 */
export type { DropletChildrenHost };

/**
 * What else the element knows about a render: the server's id, for engines
 * that key hydration by it, and the markers the server rendered.
 */
export type DropletRenderInfo = {
  /** From `data-droplet-render`; absent for markup rendered without one. */
  renderId?: string | undefined;
  /** This droplet's server-rendered `[data-droplet-children]` markers, excluding those of nested droplets. */
  markers: () => Element[];
  /** For the renderer's error boundary, when the droplet mounts with `data` still to come. */
  handleError?: (error: unknown) => Promise<unknown>;
  /** The form action's result the server rendered with, when there was one: the component's `form`. */
  form?: unknown;
  /** Where the droplet loads from (see `#location`): what its action URLs are on. */
  location?: string;
  /** The droplet's props, for its action URLs: as the server had them when it rendered. */
  props?: Record<string, unknown>;
};

export type DropletClientModule = {
  /** Mounts the droplet, or hydrates its server markup; the handle may arrive async. */
  default?: (target: HTMLElement, data: unknown, children: DropletChildrenHost, info: DropletRenderInfo) => unknown;
  /** The `props` schema from `+droplet.ts`, run where no server did it. */
  validate?: (props: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** The load of `+droplet.ts`. */
  load?: (event: { host: URL; props: Record<string, unknown>; data: unknown }) => Promise<unknown>;
  /** `handleError` of `+droplet.ts`. */
  handleError?: (error: unknown) => Promise<unknown>;
  /** Mounts or hydrates the error page; `null` when it does not run in the browser. */
  renderError?: (target: HTMLElement, error: unknown, children: DropletChildrenHost, info: DropletRenderInfo) => unknown;
  unmount?: (instance: unknown, options?: unknown) => unknown;
};

/**
 * The droplet cannot render and has nothing to show for it: a stale build,
 * props the schema refused, an answer from `_data` that is not a payload.
 * Logged, and the droplet stays empty.
 */
// A class: an error the element branches on, the stale build one included.
class NothingToRender extends Error {}

/** The server answered from another build; already reported, not a droplet error. A class: the element branches on it. */
class StaleBuildError extends NothingToRender {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { decodeBase64Json } from "./base64.ts";
import { settle } from "./load.ts";
import { propsKey } from "./props.ts";
import { enhanceSubmit } from "./enhance.ts";
import { FORM_RESULT_PREFIX, splitFormResults, withoutFormResults } from "./form.ts";
export { decodeBase64Json };

/**
 * The element's direct children, and nothing else: the payload scripts, the
 * droplet's stylesheet (with its preloads), the content root, and the host's
 * children in their one container. Markup that hosts put directly in the
 * element is removed at connect.
 */
const ALLOWED_CHILDREN =
  '[data-droplet-entry],[data-droplet-payload="context"],[data-droplet-payload="data"],[data-droplet-slot],link[data-droplet-style],link[data-droplet-preload]';
/** The droplet's `style.css`, linked inside the element. */
const STYLE_LINK = "link[data-droplet-style]";
/** What can hold focus in a droplet's markup, to put focus back after a form action renders it again. */
const FOCUSABLE = "a[href],button,input,select,textarea,[tabindex]";

type StylesheetSettledInput = { link: HTMLLinkElement };

/** Settles once the stylesheet has loaded or failed; its listeners go on before it is inserted. */
function stylesheetSettled({ link }: StylesheetSettledInput): Promise<void> {
  return new Promise((resolve) => {
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
  });
}

/** The host's children: one `<div data-droplet-slot>` the host puts in the element. */
const CONTAINER = "[data-droplet-slot]";
/** Where a component renders its children: `<div data-droplet-children style="display: contents">`. */
const MARKER = "[data-droplet-children]";

/**
 * How far ahead of the viewport a `"visible"` droplet starts loading: with
 * server markup, and without any yet (`ssr = false`), where there is
 * nothing to show until it has loaded, so it starts much earlier.
 */
const VISIBLE_MARGIN = "200px";
const VISIBLE_MARGIN_EMPTY = "1000px";
/** The first of these on its server markup brings an `"interactive"` droplet alive. */
const INTERACTIONS = ["pointerdown", "focusin", "keydown", "click"] as const;

type Movable = Element & { moveBefore?: (node: Node, child: Node | null) => void };

/**
 * Moves `nodes` to the end of `parent`. `moveBefore` keeps what the nodes
 * hold alive: a nested droplet keeps its component instance, an iframe its
 * document. It throws when the nodes and the parent are not both connected
 * (or both detached), and older browsers lack it: then the nodes are
 * re-inserted, which disconnects and reconnects them.
 */
type MoveIntoInput = { parent: Element; nodes: Iterable<Node> };

function moveInto({ parent, nodes }: MoveIntoInput): void {
  for (const node of Array.from(nodes)) {
    const movable = parent as Movable;
    if (typeof movable.moveBefore === "function") {
      try {
        movable.moveBefore(node, null);
        continue;
      } catch {
        // Different connected states, or a browser that refuses: re-insert.
      }
    }
    parent.appendChild(node);
  }
}

/**
 * A click on server markup before it hydrated, kept to be replayed on the
 * same node. The position is stored as a ratio of the node's box, so a
 * layout shift between capture and replay moves the click with the node.
 */
type QueuedClick = {
  node: Element;
  /**
   * The node's place under the content root, as child indexes, for an
   * engine that renders the markup anew instead of adopting it: the click
   * then goes to the element in that place. `null` when the node is not
   * reached through element parents (a shadow root's).
   */
  path: number[] | null;
  time: number;
  x: number;
  y: number;
  /** `screenX - clientX` at capture, so the replayed screen position keeps the same offset. */
  screenDx: number;
  screenDy: number;
  button: number;
  buttons: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  detail: number;
};

/**
 * How long the engine may take to hydrate before a held click is dropped,
 * counted from the hydrate attempt: the time spent downloading the bundle
 * and settling the data is the framework's, not the user's.
 */
const CLICK_REPLAY_MAX_AGE = 1500;
/** A click older than this is dropped however it was held: the user has moved on. */
const CLICK_REPLAY_HARD_CAP = 10_000;
/**
 * Two single clicks on one node further apart than this are a retry (the
 * first one showed nothing): replayed once, as the last.
 */
const CLICK_RETRY_GAP = 400;

type ChildPathInput = { root: Element; node: Element };

/** `node`'s place under `root` as child indexes, element children only; `null` when element parents do not lead to `root`. */
function childPath({ root, node }: ChildPathInput): number[] | null {
  const path: number[] = [];
  let current = node;
  while (current !== root) {
    const parent = current.parentElement;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.children, current));
    current = parent;
  }
  return path;
}

type NodeAtPathInput = { root: Element; path: number[] };

/** The element at `path` under `root` now, `null` when the markup is shallower. */
function nodeAtPath({ root, path }: NodeAtPathInput): Element | null {
  let current = root;
  for (const index of path) {
    const next = current.children[index];
    if (!next) return null;
    current = next;
  }
  return current;
}

type InlinePayload<T> = { found: boolean; data: T | undefined };
type ReadInlineInput = { selector: string };
type WithCacheBustInput = { url: string; token?: string | undefined };
type EnsureDropletStyleInput = { droplet: string; contentRoot: HTMLElement };
type ContentRootInput = { contentRoot: HTMLElement };
type MarkerInput = { marker: Element };
type SettleContainerInput = { markers: Iterable<Element> };
type RenderInfoInput = { contentRoot: HTMLElement; props?: Record<string, unknown> };
type CaptureClicksInput = { root: HTMLElement };
type QueuedClickInput = { root: HTMLElement; node: Element; event: MouseEvent };
type ReplayTargetInput = { root: HTMLElement; click: QueuedClick };
type ReportStaleInput = { droplet: string; served: string };
type FetchServerDataInput = { droplet: string; context: WireContext };
type ServerDataInput = FetchServerDataInput & { refresh: boolean };
export type ImportModuleInput = { droplet: string; cacheBust: boolean };
type RenderInput = {
  droplet: string;
  contentRoot: HTMLElement;
  run: number;
  cacheBust: boolean;
  reset: boolean;
  refresh: boolean;
  form?: { value: unknown };
};
type GiveUpInput = { contentRoot: HTMLElement; mod: DropletClientModule; run: number; mounted: () => Promise<unknown> };
type BoundaryHandlerInput = GiveUpInput & { droplet: string };
type ShowErrorInput = { droplet: string; contentRoot: HTMLElement; mod: DropletClientModule; error: unknown; reset: boolean; run: number };
export type StartInput = { droplet: string; contentRoot: HTMLElement; run: number; cacheBust: boolean };
type DiscardOrphanInput = { unmount: DropletClientModule["unmount"]; instance: unknown };
type DestroyInstanceInput = { fallbackUnmount?: DropletClientModule["unmount"] };
type HydrateModeInput = { droplet: string; hasMarkup: boolean };
export type ModeOfInput = { flag: HydrateMode; hasMarkup: boolean };
export type WaitForInput = { mode: "visible" | "interactive"; contentRoot: HTMLElement; hasMarkup: boolean };
type SwapInput = { droplet: string; contentRoot: HTMLElement; fresh: Element | null; run: number; cacheBust: boolean };
type OnSubmitInput = { event: Event };
/** Where focus was in the droplet's own markup: its control's place among them, and its tag. */
type FocusSpot = { index: number; tag: string };
type RestoreFocusInput = { contentRoot: HTMLElement; spot: FocusSpot | null };
type FetchFragmentInput = { droplet: string; action?: { form: unknown } };
type AdoptInput = { fresh: Element; contentRoot: HTMLElement };

/**
 * Hosts one droplet. The element is self-sufficient: it knows which origin to
 * load its JS, CSS and data from, so a page can embed droplets served by
 * several different processes. A class: the platform's custom element.
 */
export class DjsDropletElement extends HTMLElement {
  // The members named `_…` are internal, not `#private`: under `vite dev`,
  // `installDevElement` (dev-element.ts) reaches them from the prototype.
  _connected = false;
  _hydrated = false;
  _context: WireContext = { host: "", props: {} };
  /** `host` of the universal load: the page, as it was when the context was read. */
  _host: URL | null = null;
  _instance: unknown = null;
  #unmount: DropletClientModule["unmount"] | null = null;
  /**
   * Bumped on connect, disconnect and every update: a render started in an
   * earlier run stops at its next await, so two never mount into the root.
   */
  _run = 0;
  /**
   * The last `_data` request, by droplet and context. It outlives a
   * disconnect: an element taken out and put back with the same context
   * reuses the answer, or waits for it, instead of asking again.
   */
  _dataRequest: { key: string; promise: Promise<Payload> } | null = null;
  /** The host's `[data-droplet-slot]` container, once connect found it. */
  #container: HTMLElement | null = null;
  /** The markers the component filled with the container. */
  #markers = new Set<Element>();
  /** Markers set up before their markup reached the document. */
  #pendingMarkers = new Set<Element>();
  #markerWatcher: MutationObserver | null = null;
  /** A `disconnectedCallback` waiting to see whether the element comes back. */
  #leaving = false;
  /** Stops a wait for `"visible"` or `"interactive"`, which then reports `false`. */
  _stopWaiting: (() => void) | null = null;
  /** When the engine was asked to hydrate the server markup, for the click window. */
  #hydrateAttempt: number | null = null;
  /** Clicks on the server markup while its bundle loads and hydrates. */
  #clickQueue: QueuedClick[] = [];
  #clickCapture: { root: HTMLElement; listener: (event: Event) => void } | null = null;

  /** The stylesheet this element linked itself, and when it is ready. */
  #ownStyle: { link: HTMLLinkElement; ready: Promise<void> } | null = null;
  constructor() {
    super();
    // On the element, in the bubbling phase: the component's own handlers
    // run first, and a submit one of them prevented is left alone.
    this.addEventListener("submit", (event) => this.#onSubmit({ event }));
  }

  /** Imports a droplet's browser entry. Replaceable, for tests. */
  static importModule = (url: string): Promise<DropletClientModule> => import(/* @vite-ignore */ url) as Promise<DropletClientModule>;

  /** The content root is a direct child: a nested droplet has its own. */
  _contentRoot(): HTMLElement {
    const existing = this.querySelector<HTMLElement>(":scope > [data-droplet-entry]");
    if (existing) return existing;
    const div = document.createElement("div");
    div.setAttribute("data-droplet-entry", "");
    div.style.display = "contents";
    this.appendChild(div);
    return div;
  }

  /**
   * Where this droplet's JavaScript, CSS and data load from: the server's
   * location, which `/index.js` recorded from the URL the page loaded it
   * from (prefix included), else the root of the build this element came
   * with, as `$droplets/drop` and `$droplets/form` find it. Never from the
   * markup: a fragment, or anything else written into the page, cannot move it.
   */
  #location(): string {
    return serverLocation({ key: serverKey(elementName, buildHash) });
  }

  #withCacheBust({ url, token }: WithCacheBustInput): string {
    const parsed = new URL(url, this.#location());
    if (buildHash) parsed.searchParams.set("c", buildHash);
    if (token) parsed.searchParams.set("t", token);
    return parsed.toString();
  }

  /**
   * The droplet's stylesheet lives inside the element, never in `<head>`. A
   * fragment brings its `<link>`; an element without one (written by the
   * host) gets it here, from the registry, with the stylesheets `style.css`
   * imports preloaded beside it, so they download at once rather than after
   * it. All of it alongside the bundle and the data.
   */
  #ensureDropletStyle({ droplet, contentRoot }: EnsureDropletStyleInput): void {
    const files = styleRegistry.get(droplet);
    if (!files?.length || this.querySelector(`:scope > ${STYLE_LINK}`)) return;
    const base = this.#location().replace(/\/$/, "");
    for (const file of files) {
      const preload = document.createElement("link");
      preload.rel = "preload";
      preload.as = "style";
      preload.href = `${base}/${file}`;
      preload.setAttribute("data-droplet-preload", "");
      this.insertBefore(preload, contentRoot);
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = this.#withCacheBust({ url: `${base}/droplets/${encodeURIComponent(droplet)}/style.css` });
    link.setAttribute("data-droplet-style", "");
    this.#ownStyle = { link, ready: stylesheetSettled({ link }) };
    this.insertBefore(link, contentRoot);
  }

  /**
   * Before a mount: the droplet's stylesheet has loaded, or failed, so the
   * component never shows unstyled. One that came with the markup and has
   * not loaded yet may have failed before anyone listened: it is linked
   * again, and that one is waited for.
   */
  #stylesheetReady(): Promise<void> {
    const link = this.querySelector<HTMLLinkElement>(`:scope > ${STYLE_LINK}`);
    if (!link) return Promise.resolve();
    if (this.#ownStyle?.link === link) return this.#ownStyle.ready;
    if (link.sheet) return Promise.resolve();
    const fresh = link.cloneNode() as HTMLLinkElement;
    this.#ownStyle = { link: fresh, ready: stylesheetSettled({ link: fresh }) };
    link.replaceWith(fresh);
    return this.#ownStyle.ready;
  }

  /** An inline payload of this element, never of a droplet nested in it. */
  _readInline<T>({ selector }: ReadInlineInput): InlinePayload<T> {
    const raw = this.querySelector(`:scope > ${selector}`)?.textContent?.trim();
    if (!raw) return { found: false, data: undefined };
    try {
      return { found: true, data: decodeBase64Json<T>({ encoded: raw }) };
    } catch (error) {
      console.error(`[droplets] failed to parse ${selector}`, error);
      return { found: true, data: undefined };
    }
  }

  /**
   * The context, from the first place that has it: the inline script of an
   * SSR fragment, the `data-droplet-context` attribute of other fragments, or
   * `data-droplet-props`, plain JSON props a host writes by hand. `host` falls
   * back to the page the droplet runs in; it goes back to the server as it
   * came, so `_data` loads see the host the fragment was rendered for. A
   * payload that does not parse is logged and the next place is read.
   */
  #readContext(): WireContext {
    const here = pageUrl();
    this._host = new URL(here);
    const complete = (value: unknown): WireContext | null => {
      if (!isObject(value)) return null;
      return {
        host: typeof value["host"] === "string" ? value["host"] : here,
        props: isObject(value["props"]) ? value["props"] : {},
      };
    };

    const inline = this._readInline<unknown>({ selector: '[data-droplet-payload="context"]' });
    if (inline.found && inline.data !== undefined) return complete(inline.data) ?? { host: here, props: {} };

    const attr = this.dataset["dropletContext"];
    if (attr) {
      try {
        return complete(decodeBase64Json({ encoded: attr })) ?? { host: here, props: {} };
      } catch (error) {
        console.error("[droplets] failed to parse data-droplet-context", error);
      }
    }

    const params = this.dataset["dropletProps"];
    if (params) {
      try {
        const props: unknown = JSON.parse(params);
        if (isObject(props)) return { host: here, props };
        console.error("[droplets] data-droplet-props must be a JSON object");
      } catch (error) {
        console.error("[droplets] failed to parse data-droplet-props", error);
      }
    }
    return { host: here, props: {} };
  }

  /**
   * The element's direct children are a closed set: anything else a host
   * left loose in the element is removed. Children go in
   * `<div data-droplet-slot>`.
   */
  _pruneChildren(): void {
    for (const node of Array.from(this.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(ALLOWED_CHILDREN)) continue;
      node.remove();
    }
  }

  /**
   * The host's container: a direct child, or the one a previous connect
   * placed in a marker that is still in this element.
   */
  #findContainer(): HTMLElement | null {
    const direct = this.querySelector<HTMLElement>(`:scope > ${CONTAINER}`);
    if (direct) return direct;
    return this.#container && this.contains(this.#container) ? this.#container : null;
  }

  /**
   * The markers the server rendered for this droplet: those under the
   * content root that belong to no nested droplet element.
   */
  #serverMarkers({ contentRoot }: ContentRootInput): Element[] {
    return Array.from(contentRoot.querySelectorAll(MARKER)).filter((marker) => marker.closest("[data-droplet]") === this);
  }

  /**
   * Before anything loads: the container goes into the marker the server
   * rendered, visible at once. Without one (the component put its children
   * under a false `if`, or rendered nothing yet) it waits as a hidden direct
   * child, in the document, so droplets among the children load meanwhile.
   */
  #placeContainer({ contentRoot }: ContentRootInput): void {
    this.#settleContainer({ markers: this.#serverMarkers({ contentRoot }) });
  }

  /**
   * The one rule for where the container lives: in the first connected one
   * of `markers` in document order, whichever was reported first, else
   * parked under the element. A component that renders its children in
   * two places gets them in the first.
   */
  #settleContainer({ markers }: SettleContainerInput): void {
    if (!this.#container) return;
    let first: Element | null = null;
    for (const marker of markers) {
      if (!marker.isConnected) continue;
      if (!first || marker.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING) first = marker;
    }
    if (first) this.#fillMarker({ marker: first });
    else this.#parkContainer();
  }

  /** The container back under the element, hidden. */
  #parkContainer(): void {
    const container = this.#container;
    if (!container) return;
    if (container.parentNode !== this) moveInto({ parent: this, nodes: [container] });
    container.hidden = true;
  }

  /** The container into `marker`, shown. */
  #fillMarker({ marker }: MarkerInput): void {
    const container = this.#container;
    if (!container) return;
    if (container.parentNode !== marker) moveInto({ parent: marker, nodes: [container] });
    container.hidden = false;
  }

  /** Nothing rendered at all: the host's children show, under the element as they were. */
  #revealChildren({ contentRoot }: ContentRootInput): void {
    const container = this.#container;
    if (container && container.parentNode === this && contentRoot.childNodes.length === 0) container.hidden = false;
  }

  #renderInfo({ contentRoot, props = this._context.props }: RenderInfoInput): DropletRenderInfo {
    return {
      renderId: this.dataset["dropletRender"],
      markers: () => this.#serverMarkers({ contentRoot }),
      location: this.#location(),
      props,
    };
  }

  /** What the renderer's `children` calls, on the marker it renders. */
  #childrenHost(): DropletChildrenHost {
    return {
      fill: (marker) => {
        this.#markers.add(marker);
        if (marker.isConnected) this.#settleContainer({ markers: this.#markers });
        else this.#fillOnceConnected({ marker });
      },
      empty: (marker) => {
        this.#markers.delete(marker);
        this.#pendingMarkers.delete(marker);
        this.#settleContainer({ markers: this.#markers });
      },
    };
  }

  /**
   * An engine may set `children` up while its markup is still a fragment, and
   * attaches the fragment afterwards. Moving the container into a detached
   * marker would disconnect it; it waits under the element instead, and goes
   * in once the marker is in the document, where `moveBefore` keeps it alive.
   */
  #fillOnceConnected({ marker }: MarkerInput): void {
    this.#pendingMarkers.add(marker);
    this.#markerWatcher ??= new MutationObserver(() => {
      let arrived = false;
      for (const pending of Array.from(this.#pendingMarkers)) {
        if (!pending.isConnected) continue;
        this.#pendingMarkers.delete(pending);
        arrived = true;
      }
      if (arrived) this.#settleContainer({ markers: this.#markers });
      if (this.#pendingMarkers.size === 0) {
        this.#markerWatcher?.disconnect();
        this.#markerWatcher = null;
      }
    });
    this.#markerWatcher.observe(this, { childList: true, subtree: true });
  }

  /**
   * The container out of every marker, while marker and element are both in
   * the document: a `moveBefore` then keeps nested droplets alive. Runs
   * before the component unmounts, which may remove the marker before it
   * runs the component's own teardown.
   */
  #emptyMarkers(): void {
    this.#pendingMarkers.clear();
    this.#markerWatcher?.disconnect();
    this.#markerWatcher = null;
    this.#markers.clear();
    this.#parkContainer();
  }

  /**
   * Holds the clicks on server markup until it hydrates. A capture-phase
   * listener on the content root, so it runs before anything in the markup
   * and before the renderer attaches its own; the default action is
   * cancelled (a link would navigate away from a droplet about to come
   * alive) but the event still bubbles to the host. Clicks on the host's
   * children in their container are the host's business, and a nested
   * droplet holds its own.
   */
  #captureClicks({ root }: CaptureClicksInput): void {
    const listener = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("[data-droplet]") !== this || target.closest(CONTAINER)) return;
      event.preventDefault();
      // `target` is retargeted to the shadow host when the click landed in a
      // component's open shadow root (Lit): held, and replayed, on the node
      // it hit, which hydration keeps.
      const hit = event.composedPath()[0];
      const node = hit instanceof Element ? hit : target;
      const click = this.#queuedClick({ root, node, event: event as MouseEvent });
      const last = this.#clickQueue.at(-1);
      const retry = last?.node === node && last.detail === 1 && click.detail === 1 && click.time - last.time > CLICK_RETRY_GAP;
      if (retry) this.#clickQueue[this.#clickQueue.length - 1] = click;
      else this.#clickQueue.push(click);
    };
    root.addEventListener("click", listener, true);
    this.#clickCapture = { root, listener };
  }

  #queuedClick({ root, node, event }: QueuedClickInput): QueuedClick {
    const rect = node.getBoundingClientRect();
    return {
      node,
      path: childPath({ root, node }),
      time: Date.now(),
      x: rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0,
      y: rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0,
      screenDx: event.screenX - event.clientX,
      screenDy: event.screenY - event.clientY,
      button: event.button,
      buttons: event.buttons,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      detail: event.detail,
    };
  }

  /** Hydration is over, one way or another: the markup handles its own clicks from here. */
  #stopCapturingClicks(): void {
    if (!this.#clickCapture) return;
    this.#clickCapture.root.removeEventListener("click", this.#clickCapture.listener, true);
    this.#clickCapture = null;
  }

  /** Nothing to replay into: the run ended, or the droplet rendered nothing. */
  _dropClicks(): void {
    this.#stopCapturingClicks();
    this.#clickQueue = [];
  }

  /**
   * The node a held click goes to: the one it hit, while hydration kept it;
   * else the element in its place under the root, when it is the same kind
   * of element (an engine that rendered the markup anew), and nothing
   * when the markup changed shape there. Never whatever is at the click's
   * position now.
   */
  #replayTarget({ root, click }: ReplayTargetInput): Element | null {
    if (click.node.isConnected) return click.node;
    if (!click.path) return null;
    const found = nodeAtPath({ root, path: click.path });
    return found?.localName === click.node.localName ? found : null;
  }

  /**
   * The held clicks, in order, each on the node it hit or the one in its
   * place (`#replayTarget`). The coordinates follow the node's current box.
   * A dispatched click runs the node's default action, as the real one
   * would have, unless the component's handler prevents it.
   */
  #replayClicks(): void {
    const root = this.#clickCapture?.root;
    this.#stopCapturingClicks();
    const queue = this.#clickQueue;
    this.#clickQueue = [];
    if (!root) return;
    const now = Date.now();
    const attempt = this.#hydrateAttempt ?? now;
    for (const click of queue) {
      const waited = now - Math.max(click.time, attempt);
      if (waited > CLICK_REPLAY_MAX_AGE || now - click.time > CLICK_REPLAY_HARD_CAP) continue;
      const node = this.#replayTarget({ root, click });
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const clientX = rect.left + rect.width * click.x;
      const clientY = rect.top + rect.height * click.y;
      node.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX,
          clientY,
          screenX: clientX + click.screenDx,
          screenY: clientY + click.screenDy,
          button: click.button,
          buttons: click.buttons,
          ctrlKey: click.ctrlKey,
          shiftKey: click.shiftKey,
          altKey: click.altKey,
          metaKey: click.metaKey,
          detail: click.detail,
        }),
      );
    }
  }

  /** A `moveBefore` of this element keeps its instance: nothing to do. */
  connectedMoveCallback(): void {}

  /** Tells the page this loader is older (or newer) than the server. */
  #reportStale({ droplet, served }: ReportStaleInput): void {
    const detail: DropletStaleDetail = { element: elementName, droplet, loaded: buildHash, served };
    this.dispatchEvent(new CustomEvent(STALE_EVENT, { bubbles: true, composed: true, detail }));
  }

  /**
   * `{ data }`, or `{ error }` with a 500 when a load failed on the server.
   * Anything else (`error()`, a redirect, an unhandled failure) is an
   * endpoint's answer, not something the droplet can show.
   */
  async #fetchServerData({ droplet, context }: FetchServerDataInput): Promise<Payload> {
    const base = this.#location().replace(/\/$/, "");
    const url = new URL(`${base}/droplets/${encodeURIComponent(droplet)}/_data`);
    // The cache-buster only: props travel in the body's context, and the
    // page's own query string is never the droplet's to see.
    url.search = new URLSearchParams({ __cb: Date.now().toString() }).toString();

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(context),
      // A redirect is an answer for the page, not data: never follow it.
      redirect: "manual",
    });
    const served = response.headers.get("x-droplets-build");
    if (buildHash && served && served !== buildHash) {
      this.#reportStale({ droplet, served });
      throw new StaleBuildError(`${droplet}: served by build ${served}, this page runs ${buildHash}`);
    }
    const payload: unknown = await response.json().catch(() => undefined);
    if (response.ok && isObject(payload)) {
      return Object.hasOwn(payload, "form") ? { data: payload["data"], form: payload["form"] } : { data: payload["data"] };
    }
    if (response.status === 500 && isObject(payload) && "error" in payload) {
      return { failed: true, error: payload["error"] };
    }
    throw new NothingToRender(
      `${droplet}: _data answered ${response.status || response.type}${
        isObject(payload) && typeof payload["message"] === "string" ? `: ${payload["message"]}` : ""
      }`,
    );
  }

  /**
   * The `_data` request for this context: the one in flight or answered,
   * when the context is the same, else a new one. A request that fails or
   * answers an error is forgotten, so the next connect asks again.
   */
  _serverData({ droplet, context, refresh }: ServerDataInput): Promise<Payload> {
    const key = `${droplet}\n${context.host}\n${propsKey(context.props)}`;
    if (!refresh && this._dataRequest?.key === key) return this._dataRequest.promise;
    const forget = () => {
      if (this._dataRequest?.promise === promise) this._dataRequest = null;
    };
    const promise: Promise<Payload> = this.#fetchServerData({ droplet, context }).then(
      (payload) => {
        if (payload.failed) forget();
        return payload;
      },
      (error: unknown) => {
        forget();
        throw error;
      },
    );
    this._dataRequest = { key, promise };
    return promise;
  }

  /** The droplet's browser entry; `null` (logged) when it cannot load. */
  async _importModule({ droplet, cacheBust }: ImportModuleInput): Promise<DropletClientModule | null> {
    try {
      const base = this.#location().replace(/\/$/, "");
      const clientUrl = this.#withCacheBust({
        url: `${base}/droplets/${encodeURIComponent(droplet)}/client.js`,
        token: cacheBust ? Date.now().toString() : undefined,
      });
      return await DjsDropletElement.importModule(clientUrl);
    } catch (error) {
      console.error("[droplets] failed to render droplet", error);
      return null;
    }
  }

  /**
   * Server data, props and the component. Server markup with its data
   * inline hydrates once the data is settled, as the server rendered it; a
   * load that fails then shows `+error.*`, through `handleError`. Anything
   * else mounts at once, with `data` the promise of what `_data` (or the
   * inline data) and the load of `+droplet.ts` make: the component decides
   * how to wait, and the renderer's error boundary shows `+error.*` for a
   * rejection that reaches it. The schema runs first where no server did.
   * `false` when nothing rendered, or when `run` is over.
   */
  async #render({ droplet, contentRoot, run, cacheBust, reset, refresh, form: action }: RenderInput): Promise<boolean> {
    const mod = await this._importModule({ droplet, cacheBust });
    if (run !== this._run) return false;
    if (!mod) {
      contentRoot.replaceChildren();
      return false;
    }
    if (!mod.default) return false;
    const render = mod.default;

    try {
      const context = this._context;
      let props = context.props;
      const inline = refresh ? { found: false, data: undefined } : this._readInline<unknown>({ selector: '[data-droplet-payload="data"]' });
      const inlinePayload = (): Payload =>
        isObject(inline.data) && "error" in inline.data
          ? { failed: true, error: inline.data["error"] }
          : { data: isObject(inline.data) ? inline.data["data"] : undefined };
      // After a form action the server rendered with `form`: so does the browser.
      let form: { form?: unknown } = action
        ? { form: action.value }
        : inline.found && isObject(inline.data) && inline.data["form"] !== undefined
          ? { form: inline.data["form"] }
          : {};
      if (!inline.found && mod.validate) {
        try {
          props = await mod.validate(props);
        } catch (error) {
          throw new NothingToRender(`${droplet}: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (run !== this._run) return false;
      }
      // In the browser the page itself, read once when the droplet mounted;
      // a no-JavaScript action's result in its query is the framework's.
      const host = withoutFormResults(this._host ?? new URL(pageUrl()));
      const load = (payload: Payload): unknown => {
        // Already through the server's handleError: continues with this one.
        if (payload.failed) throw payload.error;
        return mod.load ? mod.load({ host, props, data: payload.data }) : payload.data;
      };

      if (inline.found && !reset && contentRoot.childNodes.length > 0) {
        const payload = inlinePayload();
        if (payload.failed) return this.#showError({ droplet, contentRoot, mod, error: payload.error, reset: true, run });
        // What the server rendered with: hydration must see the same values.
        const data = await settle(load(payload));
        if (run !== this._run) return false;
        await this.#destroyInstance({ fallbackUnmount: mod.unmount });
        if (run !== this._run) return false;
        // An engine comparing the server markup with its own tree would take
        // the container in the marker for a mismatch: out before, back in
        // through `fill` as it hydrates, in one task, so nothing paints between.
        this.#parkContainer();
        this.#hydrateAttempt = Date.now();
        const instance = await render(contentRoot, data, this.#childrenHost(), { ...this.#renderInfo({ contentRoot, props }), ...form });
        // The run ended while the engine was still at it: nothing owns the handle.
        if (run !== this._run) return this.#discardOrphan({ unmount: mod.unmount, instance });
        this._instance = instance;
        this.#unmount = mod.unmount ?? null;
        return true;
      }

      let mounted: Promise<unknown> = Promise.resolve();
      // A no-JavaScript action's result for this droplet in the page's URL
      // goes to `_data` with the context's host (a server-fetched fragment's
      // context never has it), and the droplet waits for both.
      const dataHost = action ? context.host : withPageResult({ host: context.host, droplet });
      const payload: Promise<Payload> = inline.found
        ? Promise.resolve(inlinePayload())
        : serverLoadRegistry.has(droplet)
          ? this._serverData({ droplet, context: { host: dataHost, props }, refresh })
          : Promise.resolve({ data: undefined });
      const carried = !action && !inline.found && serverLoadRegistry.has(droplet) && carriesFormResult({ host: dataHost, droplet });
      let data: unknown;
      if (action || carried) {
        // After a form action: the loads first, then the component, in one
        // task, so the droplet never shows a pending state in between.
        const answered = await payload;
        if (run !== this._run) return false;
        if (answered.failed) return this.#showError({ droplet, contentRoot, mod, error: answered.error, reset: true, run });
        if (carried && answered.form !== undefined) form = { form: answered.form };
        data = await settle(load(answered));
        if (run !== this._run) return false;
      } else {
        data = payload.then(load, (error: unknown) => {
          if (!(error instanceof NothingToRender)) throw error;
          // Nothing the component could show (a stale build, an answer that is
          // no payload): the droplet goes, and `data` never settles.
          if (!(error instanceof StaleBuildError)) console.error(`[droplets] ${droplet}:`, error.message);
          void this.#giveUp({ contentRoot, mod, run, mounted: () => mounted });
          return new Promise<never>(() => {});
        });
      }
      await this.#stylesheetReady();
      if (run !== this._run) return false;
      await this.#destroyInstance({ fallbackUnmount: mod.unmount });
      if (run !== this._run) return false;
      this.#parkContainer();
      contentRoot.replaceChildren();
      const info = {
        ...this.#renderInfo({ contentRoot, props }),
        ...form,
        handleError: this.#boundaryHandler({ droplet, contentRoot, mod, run, mounted: () => mounted }),
      };
      mounted = Promise.resolve(render(contentRoot, data, this.#childrenHost(), info));
      const instance = await mounted;
      if (run !== this._run) return this.#discardOrphan({ unmount: mod.unmount, instance });
      this._instance = instance;
      this.#unmount = mod.unmount ?? null;
    } catch (error) {
      if (run !== this._run) return false;
      if (error instanceof NothingToRender) {
        if (!(error instanceof StaleBuildError)) console.error(`[droplets] ${droplet}:`, error.message);
        await this.#destroyInstance({ fallbackUnmount: mod.unmount });
        contentRoot.replaceChildren();
        return false;
      }
      console.error(`[droplets] ${droplet} failed`, error);
      return this.#showError({ droplet, contentRoot, mod, error, reset: true, run });
    }
    return true;
  }

  /**
   * What the renderer's error boundary calls with an error that reached it:
   * the error page's `error`, out of `handleError` of `+droplet.ts`. Rejects
   * when there is nothing to show: the run is over, or `handleError` threw,
   * and then the droplet goes as one that renders nothing.
   */
  #boundaryHandler({ droplet, contentRoot, mod, run, mounted }: BoundaryHandlerInput): (error: unknown) => Promise<unknown> {
    return async (error) => {
      if (run !== this._run) throw error;
      console.error(`[droplets] ${droplet} failed`, error);
      try {
        return mod.handleError ? await mod.handleError(error) : error;
      } catch (handleError) {
        console.error(`[droplets] ${droplet}: handleError threw`, handleError);
        void this.#giveUp({ contentRoot, mod, run, mounted });
        throw handleError;
      }
    };
  }

  /**
   * A mounted droplet with nothing to show after all (its data cannot load,
   * or `handleError` threw): taken down once its mount is through, the
   * host's children back as they were.
   */
  async #giveUp({ contentRoot, mod, run, mounted }: GiveUpInput): Promise<void> {
    // A mount that failed is the boundary's to report; the droplet goes either way.
    await mounted().catch(() => undefined);
    // After `#render` took the handle, which waits on the same promise.
    await Promise.resolve();
    if (run !== this._run) return;
    await this.#destroyInstance({ fallbackUnmount: mod.unmount });
    if (run !== this._run) return;
    contentRoot.replaceChildren();
    this._hydrated = false;
    this.#revealChildren({ contentRoot });
  }

  /**
   * `+error.*` in place of the droplet, with what `handleError` of
   * `+droplet.ts` makes of the error. Nothing renders when the droplet has
   * no error page in the browser, or when `handleError` throws. `reset`
   * clears what is there first; hydrating server markup keeps it.
   */
  async #showError({ droplet, contentRoot, mod, error, reset, run }: ShowErrorInput): Promise<boolean> {
    if (reset || contentRoot.childNodes.length === 0) await this.#stylesheetReady();
    if (run !== this._run) return false;
    await this.#destroyInstance({ fallbackUnmount: mod.unmount });
    if (run !== this._run) return false;
    if (reset) contentRoot.replaceChildren();
    let shown: unknown;
    try {
      shown = mod.handleError ? await mod.handleError(error) : error;
    } catch (handleError) {
      if (run !== this._run) return false;
      console.error(`[droplets] ${droplet}: handleError threw`, handleError);
      contentRoot.replaceChildren();
      return false;
    }
    if (run !== this._run) return false;
    try {
      this.#parkContainer();
      const instance = (await mod.renderError?.(contentRoot, shown, this.#childrenHost(), this.#renderInfo({ contentRoot }))) ?? null;
      if (run !== this._run) return this.#discardOrphan({ unmount: mod.unmount, instance });
      this._instance = instance;
      this.#unmount = this._instance ? (mod.unmount ?? null) : null;
    } catch (renderError) {
      console.error("[droplets] the error page failed", renderError);
      this._instance = null;
    }
    if (!this._instance) {
      contentRoot.replaceChildren();
      return false;
    }
    return true;
  }

  /**
   * The server rendered (or, with `ssr = false`, left room for) the
   * droplet's `+error.*`: hydrate or mount it from the inline error.
   */
  async #renderServerError({ droplet, contentRoot, run, cacheBust }: StartInput): Promise<boolean> {
    const inline = this._readInline<unknown>({ selector: '[data-droplet-payload="data"]' });
    if (!inline.found || !isObject(inline.data) || !("error" in inline.data)) return false;
    const mod = await this._importModule({ droplet, cacheBust });
    if (!mod || run !== this._run) return false;
    return this.#showError({ droplet, contentRoot, mod, error: inline.data["error"], reset: false, run });
  }

  /**
   * An instance that arrived after its run ended (the element was taken out
   * or updated while the engine rendered): unmounted here, since no later
   * `#destroyInstance` will see it. Always `false`: nothing rendered.
   */
  async #discardOrphan({ unmount, instance }: DiscardOrphanInput): Promise<false> {
    if (instance === null || instance === undefined) return false;
    try {
      await unmount?.(instance);
    } catch (error) {
      console.error("[droplets] failed to unmount droplet", error);
    }
    return false;
  }

  /** Unmounts the component, with the host's container out of its markers first. */
  async #destroyInstance({ fallbackUnmount }: DestroyInstanceInput = {}): Promise<void> {
    this.#emptyMarkers();
    if (!this._instance) return;
    const unmount = this.#unmount ?? fallbackUnmount;
    try {
      if (unmount) await unmount(this._instance);
    } catch (error) {
      console.error("[droplets] failed to unmount droplet", error);
    } finally {
      this._instance = null;
      this.#unmount = null;
    }
  }

  /**
   * What the element holds comes alive: server markup hydrates, its clicks
   * held meanwhile, or stays as the server rendered it; anything else
   * mounts. With nothing to show, the host's children show as they were.
   */
  async _start({ droplet, contentRoot, run, cacheBust }: StartInput): Promise<boolean | undefined> {
    // A load failed on the server: +error.*, the droplet's error boundary,
    // stands in for it and hydrates as the droplet would.
    const isError = this.dataset["dropletError"] !== undefined;
    const hasMarkup = contentRoot.childNodes.length > 0;
    const mode = this.#hydrateMode({ droplet, hasMarkup });
    // Server markup that is about to hydrate: hold its clicks until it has.
    // Nothing to hold for a client-only droplet, nor for one that stays as
    // the server rendered it.
    const handleEventsUntilHydrate = mode !== false && hasMarkup;
    if (handleEventsUntilHydrate) this.#captureClicks({ root: contentRoot });
    // Nothing loads before then: no bundle, no `_data`.
    if (mode === "visible" || mode === "interactive") {
      if (!(await this._waitFor({ mode, contentRoot, hasMarkup })) || run !== this._run) return;
    }

    let rendered = false;
    if (mode !== false) {
      rendered = isError
        ? await this.#renderServerError({ droplet, contentRoot, run, cacheBust })
        : await this.#render({ droplet, contentRoot, run, cacheBust, reset: false, refresh: false });
    }
    if (run !== this._run) return;
    this._hydrated = rendered;
    if (rendered) this.#replayClicks();
    else {
      // The droplet has nothing to show: the host's children stand as they were.
      this._dropClicks();
      this.#revealChildren({ contentRoot });
    }
    return rendered;
  }

  /**
   * When the droplet comes alive: the host's `data-droplet-hydrate` (`true`,
   * `false`, `visible`, `interactive`) over the droplet's flag; `false` when
   * it ships no bundle. Without server markup there is nothing to interact
   * with, so `"interactive"` is at once.
   */
  #hydrateMode({ droplet, hasMarkup }: HydrateModeInput): HydrateMode {
    const flag = hydrationRegistry.get(droplet);
    if (flag === undefined) return false;
    return this._modeOf({ flag, hasMarkup });
  }

  /** The mode the droplet's `hydrate` flag gives this element: its `data-droplet-hydrate` over the flag. */
  _modeOf({ flag, hasMarkup }: ModeOfInput): HydrateMode {
    if (flag === false) return false;
    let mode: HydrateMode = flag;
    const asked = this.dataset["dropletHydrate"];
    if (asked !== undefined) {
      const parsed =
        asked === "" || asked === "true"
          ? true
          : asked === "false"
            ? scriptRegistry.has(this.dataset["droplet"] ?? "")
              ? undefined
              : false
            : asked === "visible" || asked === "interactive"
              ? asked
              : undefined;
      if (parsed !== undefined) mode = parsed;
    }
    return mode === "interactive" && !hasMarkup ? true : mode;
  }

  /**
   * Until the droplet should come alive: `true` as it is about to scroll
   * into view (`"visible"`), or on the first interaction with its own markup
   * (`"interactive"`; the host's children and nested droplets are not its
   * own); `false` when the element left or updated first.
   */
  _waitFor({ mode, contentRoot, hasMarkup }: WaitForInput): Promise<boolean> {
    return new Promise((resolve) => {
      let cleanup = () => {};
      const done = (value: boolean) => {
        cleanup();
        this._stopWaiting = null;
        resolve(value);
      };
      this._stopWaiting = () => done(false);
      if (mode === "visible") {
        if (typeof IntersectionObserver === "undefined") return done(true);
        const observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) done(true);
          },
          { rootMargin: hasMarkup ? VISIBLE_MARGIN : VISIBLE_MARGIN_EMPTY },
        );
        observer.observe(this);
        cleanup = () => observer.disconnect();
        return;
      }
      const listener = (event: Event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target || target.closest("[data-droplet]") !== this || target.closest(CONTAINER)) return;
        done(true);
      };
      for (const type of INTERACTIONS) contentRoot.addEventListener(type, listener, { capture: true, passive: true });
      cleanup = () => {
        for (const type of INTERACTIONS) contentRoot.removeEventListener(type, listener, { capture: true });
      };
    });
  }

  /** Whether the element came alive in the run it started (dev subscribes to edits then). */
  async connectedCallback(): Promise<boolean> {
    // Back in the same task it left in: nothing happened.
    if (this._connected) return false;
    this._connected = true;
    const run = ++this._run;

    const droplet = this.dataset["droplet"];
    // Unknown droplet: leave any SSR markup alone rather than guessing.
    if (!droplet || !dropletRegistry.has(droplet)) return false;

    this._context = this.#readContext();
    const contentRoot = this._contentRoot();
    this.#container = this.#findContainer();
    this._pruneChildren();
    this.#placeContainer({ contentRoot });
    this.#ensureDropletStyle({ droplet, contentRoot });

    // A deploy happened while the page stayed open: this loader's bundles
    // are from another build. Keep the server HTML, tell the page.
    const served = this.dataset["dropletBuild"];
    if (buildHash && served && served !== buildHash) {
      this.#reportStale({ droplet, served });
      return false;
    }

    await this._start({ droplet, contentRoot, run, cacheBust: false });
    return run === this._run;
  }

  /**
   * The droplet over again: the server's new answer in place of the old one
   * (`fresh`), or nothing, to mount in the browser; then it comes alive as
   * on connect. The host's children are carried over.
   */
  async _swap({ droplet, contentRoot, fresh, run, cacheBust }: SwapInput): Promise<void> {
    await this.#destroyInstance();
    if (run !== this._run) return;
    if (fresh) this.#adopt({ fresh, contentRoot });
    else contentRoot.replaceChildren();
    this.#ensureDropletStyle({ droplet, contentRoot });
    this.#placeContainer({ contentRoot });
    await this._start({ droplet, contentRoot, run, cacheBust });
  }

  /**
   * Where this droplet's form actions are: its id and its location
   * (`<location>/droplets/<id>` is the action URL), for
   * `enhanceDropletForm` to tell its own forms' submits from any other.
   * `null` while the element is not connected, or holds no droplet of
   * this build.
   */
  actionTarget(): { droplet: string; location: string } | null {
    const droplet = this.dataset["droplet"];
    if (!this._connected || !droplet || !dropletRegistry.has(droplet)) return null;
    // From another build than this loader: as on connect, the page decides.
    const served = this.dataset["dropletBuild"];
    if (buildHash && served && served !== buildHash) return null;
    return { droplet, location: this.#location() };
  }

  /**
   * After an enhanced submit (`enhanceDropletForm`): the droplet renders
   * again with the action's result as `form`. A droplet live in the
   * browser renders with its loads run again (through `_data`, as a
   * refresh); one that is not (`hydrate = false`, or not hydrated yet)
   * gets its fragment rendered again by the server with `form`, in place
   * of its content. Focus goes back to the control in the same place.
   */
  async updateForm(form: unknown): Promise<void> {
    const target = this.actionTarget();
    if (!target) return;
    const { droplet } = target;
    const run = ++this._run;
    this._stopWaiting?.();
    this._dropClicks();
    const contentRoot = this._contentRoot();
    const spot = this.#focusSpot({ contentRoot });
    if (this._hydrated) {
      const rendered = await this.#render({
        droplet,
        contentRoot,
        run,
        cacheBust: false,
        reset: true,
        refresh: true,
        form: { value: form },
      });
      if (run !== this._run) return;
      this._hydrated = rendered;
      if (!rendered) this.#revealChildren({ contentRoot });
    } else {
      // Nothing in the browser renders it: the server does, with the
      // context the droplet was rendered with and the action's result.
      const fresh = await this._fetchFragment({ droplet, action: { form } });
      if (run !== this._run || !fresh) return;
      await this._swap({ droplet, contentRoot, fresh, run, cacheBust: false });
      if (run !== this._run) return;
    }
    this.#restoreFocus({ contentRoot, spot });
  }

  /**
   * A submit in the element's subtree, from a form of its own markup that
   * says `data-droplet-enhance` (a template's way to opt in; components
   * use `enhanceDropletForm`): enhanced as `enhanceDropletForm` would.
   * Every other form is left alone.
   */
  #onSubmit({ event }: OnSubmitInput): void {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute("data-droplet-enhance")) return;
    if (form.closest("[data-droplet]") !== this) return;
    enhanceSubmit(event, form);
  }

  /** This droplet's own focusable controls, in document order: not the host's children, not a nested droplet's. */
  #focusables({ contentRoot }: ContentRootInput): Element[] {
    return Array.from(contentRoot.querySelectorAll(FOCUSABLE)).filter((node) => {
      const slot = node.closest(CONTAINER);
      return node.closest("[data-droplet]") === this && !(slot && this.contains(slot));
    });
  }

  #focusSpot({ contentRoot }: ContentRootInput): FocusSpot | null {
    const active = document.activeElement;
    if (!active || !contentRoot.contains(active)) return null;
    const index = this.#focusables({ contentRoot }).indexOf(active);
    return index < 0 ? null : { index, tag: active.localName };
  }

  /**
   * After the droplet rendered again: focus, lost with the old markup, goes
   * to the control in the same place when it is the same kind of control,
   * without scrolling. Focus that moved on meanwhile stays where it is.
   */
  #restoreFocus({ contentRoot, spot }: RestoreFocusInput): void {
    if (!spot) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const control = this.#focusables({ contentRoot })[spot.index];
    if (control instanceof HTMLElement && control.localName === spot.tag) control.focus({ preventScroll: true });
  }

  /**
   * The fragment again, as a host's server asks for it, with the element's
   * context: for an HMR update in dev, and after a form action on a droplet
   * that has not hydrated, with the action's result as `form`. `null`,
   * logged, when the answer is no fragment of this droplet; `null`, reported
   * as stale and not logged, when another build answered: whatever it
   * answered (a 404 for a droplet it no longer has) is that build's.
   */
  async _fetchFragment({ droplet, action }: FetchFragmentInput): Promise<Element | null> {
    const base = this.#location().replace(/\/$/, "");
    const { host, props } = this._context;
    try {
      const response = await fetch(`${base}/droplets/${encodeURIComponent(droplet)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action ? { host, props, form: action.form } : { host, props }),
        redirect: "manual",
      });
      const served = response.headers.get("x-droplets-build");
      if (buildHash && served && served !== buildHash) {
        this.#reportStale({ droplet, served });
        return null;
      }
      if (!(response.headers.get("content-type") ?? "").includes("text/html")) {
        throw new Error(`answered ${response.status || response.type}`);
      }
      const template = document.createElement("template");
      template.innerHTML = await response.text();
      const fresh = template.content.querySelector("[data-droplet]");
      if (!fresh || fresh.getAttribute("data-droplet") !== droplet) throw new Error("answered no droplet");
      return fresh;
    } catch (error) {
      console.error(`[droplets] ${droplet}: could not fetch the fragment again`, error);
      return null;
    }
  }

  /** The server's new answer in place of the old one, the host's container kept. */
  #adopt({ fresh, contentRoot }: AdoptInput): void {
    for (const name of ["data-droplet-build", "data-droplet-render", "data-droplet-context", "data-droplet-error"]) {
      const value = fresh.getAttribute(name);
      if (value === null) this.removeAttribute(name);
      else this.setAttribute(name, value);
    }
    // Preloads this element added for a stylesheet it linked itself: the
    // answer brings its own link, or the element links one again after.
    for (const preload of this.querySelectorAll(":scope > link[data-droplet-preload]")) preload.remove();
    for (const selector of ['[data-droplet-payload="context"]', '[data-droplet-payload="data"]', STYLE_LINK]) {
      this.querySelector(`:scope > ${selector}`)?.remove();
      const node = fresh.querySelector(`:scope > ${selector}`);
      if (node) this.insertBefore(node, contentRoot);
    }
    const entry = fresh.querySelector(":scope > [data-droplet-entry]");
    contentRoot.replaceChildren(...Array.from(entry?.childNodes ?? []));
    this._context = this.#readContext();
  }

  /**
   * Taken out of the document. Not necessarily for good: a host without
   * `moveBefore` re-inserts to move, and an engine re-ordering its parent
   * removes and appends. The teardown waits a microtask and runs only if the
   * element is still out; put back in the same task, the instance lives on.
   */
  disconnectedCallback(): void {
    if (this.#leaving) return;
    this.#leaving = true;
    queueMicrotask(() => {
      this.#leaving = false;
      if (!this.isConnected) void this._teardown();
    });
  }

  async _teardown(): Promise<void> {
    ++this._run;
    this._stopWaiting?.();
    this._connected = false;
    this._hydrated = false;
    this._dropClicks();
    await this.#destroyInstance();
  }
}

if (import.meta.env.DEV) {
  installDevElement(DjsDropletElement, {
    url: import.meta.url,
    elementName,
    buildHash,
    droplets: dropletRegistry,
    hydration: hydrationRegistry,
    serverLoad: serverLoadRegistry,
    scripts: scriptRegistry,
    allowedChildren: ALLOWED_CHILDREN,
    nothingToRender: NothingToRender,
    staleBuild: StaleBuildError,
    pageUrl,
    location: () => serverLocation({ key: serverKey(elementName, buildHash) }),
  });
}

// The tag name comes from `config.element`, so two droplets servers with
// different names can share a page, each with its own registry.
if (!customElements.get(elementName)) {
  customElements.define(elementName, DjsDropletElement);
} else {
  // A second copy of the entry client loaded; adopt existing elements.
  document.querySelectorAll(elementName).forEach((el) => {
    customElements.upgrade(el);
  });
}

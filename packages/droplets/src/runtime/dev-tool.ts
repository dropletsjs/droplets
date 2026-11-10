/**
 * What `index.js` hands the Droplets dev tool under `vite dev`, through
 * `window.DropletsDevTools.register(source)`: one source per droplets
 * server on the page. The tool itself comes with
 * `@dropletsjs/devtools`; the first `index.js` that loads it
 * creates it, every one registers with it.
 */
import type { DevStrategy } from "../core/config.ts";
import type { HydrateMode } from "../renderer.ts";

/**
 * Where an element is: `waiting` for `"visible"` or `"interactive"`,
 * `loading` its bundle and data, `hydrated` (server markup) or `mounted`
 * (none), `error` showing `+error.*`, `static` as the server rendered it,
 * `empty` with nothing to show.
 */
export type DevElementState = "waiting" | "loading" | "hydrated" | "mounted" | "error" | "static" | "empty";

export type DevElementInfo = {
  element: HTMLElement;
  droplet: string;
  state: DevElementState;
  /** When it hydrates, the host's `data-hydrate` applied; `false`: never. */
  hydrate: HydrateMode;
  /** Its files changed and it has not loaded again since (`manual`). */
  changed: boolean;
};

export type DevToolSource = {
  /** The droplets server this `index.js` came from: its URL, with any path prefix. */
  origin: string;
  /** Its custom element name. */
  element: string;
  /** The HMR strategy in effect (`hmr`, `remount`, `reload`, `manual`): the tool's choice, else `index.js?strategy=`, else `dev.strategy`. */
  strategy(): DevStrategy;
  /** The tool's choice, kept for the tab's session. */
  setStrategy(strategy: DevStrategy): void;
  /** The elements of this server on the page, in document order. */
  elements(): DevElementInfo[];
  /** Loads the element again, as `remount` does. */
  remount(element: HTMLElement): void;
  reload(): void;
  /** Called whenever an element connects, leaves, changes state or its files change. */
  subscribe(listener: () => void): () => void;
};

/**
 * Something the page should know under `vite dev` that it cannot show by
 * itself: a droplet's new render contract (`ssr`, `hydrate`, `prerender`),
 * a `hooks.client.ts` edit. Plain data.
 */
export type DevNotification = {
  /** The same key replaces an earlier notification rather than stacking: `<origin> <droplet> contract`. */
  key: string;
  /** Names the droplet and the change: `counter changed its render contract: hydrate true → false`. */
  message: string;
  /** What happens next, or what to do. */
  detail?: string;
  /** Offer "Reload page": the change shows only once the page renders afresh. */
  reload?: boolean;
};

export type DropletsDevTools = {
  register(source: DevToolSource): void;
  /**
   * Shows a notification in the tool, with a "Reload page" button that
   * calls `reload` when `notification.reload` is set. Without it (an older
   * tool), `index.js` shows its own toast.
   */
  notify?(notification: DevNotification, reload: () => void): void;
};

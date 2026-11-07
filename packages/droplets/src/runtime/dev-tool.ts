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
  /** The HMR strategy in effect: the tool's choice, else `index.js?strategy=`, else `dev.strategy`. */
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

export type DropletsDevTools = { register(source: DevToolSource): void };

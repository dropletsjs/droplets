/**
 * Dev only: what `index.js` does under `vite dev` on top of the element
 * (`entry-client.ts`), installed on its prototype by `installDevElement`,
 * which the entry calls under `import.meta.env.DEV` alone. A production
 * build drops that call and, with it, this module and what it imports.
 *
 * - `dev.strategy` (`hmr`, `remount`, `reload`, `manual`), the dev tool's
 *   choice or `index.js?strategy=…` over it, for each edit the plugin
 *   announces with `droplets:update`.
 * - `update(payload)`, the remount: the droplet loads again by its flags as
 *   they are now.
 * - Under `hmr`: new data for a load edit, a new render contract's notice,
 *   and the client module's fallback for an edit no framework HMR took.
 * - The dev tool (`dev.injectTool`, `index.js?injectTool=true`) and what it
 *   lists of the elements.
 * - Warnings about what a host wrote: loose children, an unknown `data-hydrate`.
 *
 * Nothing runs at the top level: the module only exports.
 */
import { strategy as configStrategy, injectTool as configInjectTool, toolUrl } from "virtual:droplets-dev";
import type { DevStrategy } from "../core/config.ts";
import type { HydrateMode } from "../renderer.ts";
import { contractChanges, contractNotice, hydrateAction, readContract, type ElementLife, type RenderContract } from "./dev-contract.ts";
import { notify } from "./dev-notify.ts";
import type { DevElementInfo, DevElementState, DevToolSource, DropletsDevTools } from "./dev-tool.ts";
import type { DjsDropletElement, DropletClientModule, Payload } from "./entry-client.ts";
import { withoutFormResults } from "./form.ts";
import { settle } from "./load.ts";

/**
 * Sent by the Vite plugin over Vite's own HMR channel in dev, once per edit
 * and droplet, before Vite's own update. Plain data, checked on arrival.
 */
export type DropletUpdatePayload = {
  droplet: string;
  /**
   * What the edit touched: the `component` (or what it imports), a `load`
   * (`+droplet.server.ts`, `+droplet.ts`, or a server file they import), or
   * the render `contract` (`ssr`, `hydrate`, `prerender`). Absent: load it
   * again (the dev tool's Remount).
   */
  kind?: "component" | "load" | "contract";
  /** The edit's HMR timestamp: Vite's update for it carries the same one. */
  timestamp?: number;
  /** A load edit reached `+droplet.ts`: the browser's load is new too. */
  universal?: boolean;
  /** With `kind: "contract"`: the flags before and after the edit. */
  before?: RenderContract;
  after?: RenderContract;
  hydrate?: boolean | "visible" | "interactive";
  /** Whether the droplet has `+droplet.server.ts` now. */
  serverLoad?: boolean;
};

/** Sent when the page itself is out of date: `src/hooks.client.ts` changed, and its `init` runs once per page. */
export type DropletHooksPayload = { reason: "hooks.client"; timestamp: number };

declare module "vite/types/customEvent.d.ts" {
  // biome-ignore lint/style/useConsistentTypeDefinitions: an augmentation of Vite's map; `type` cannot merge.
  interface CustomEventMap {
    "droplets:update": DropletUpdatePayload;
    "droplets:hooks-client": DropletHooksPayload;
  }
}

/** What `installDevElement` adds to the element. */
export type DevDropletElement = DjsDropletElement & {
  /** The remount: the droplet loads again by its flags as they are now, the way it reached the page. */
  update(payload: DropletUpdatePayload): Promise<void>;
};

export type DevDropletElementClass = typeof DjsDropletElement & {
  /** This server's elements on the page, in document order, as the dev tool lists them. */
  devElements(): DevElementInfo[];
};

/** What the entry hands over: its registries and the few things both need. */
export type DevElementEnv = {
  /** `import.meta.url` of `index.js`: its origin, `?strategy=` and `?injectTool=`. */
  url: string;
  elementName: string;
  droplets: ReadonlySet<string>;
  hydration: Map<string, HydrateMode>;
  serverLoad: Set<string>;
  /** Script droplets: the element ignores `data-hydrate="false"` on them. */
  scripts: ReadonlySet<string>;
  /** Selector of what may be a direct child of the element. */
  allowedChildren: string;
  /** Errors the element logs as "nothing to render", the stale build one not even that. */
  nothingToRender: abstract new (
    ...args: never[]
  ) => Error;
  staleBuild: abstract new (...args: never[]) => Error;
  pageUrl(): string;
  /** Where `index.js` came from, as the elements load from it. */
  location(): string | undefined;
};

/** A client module of a droplet under `vite dev`: with `update` when its renderer has a `clientDev` module. */
type DevClientModule = DropletClientModule & {
  /** New `data` for the live instance `default` returned, which keeps its state; `false` when its renderer cannot. */
  update?: (instance: unknown, data: unknown, info?: { form?: unknown }) => Promise<boolean>;
};

/** What dev keeps of one element. */
type DevState = {
  /**
   * How the element reached the page, for a remount. A fragment of the
   * server is asked for again; an element the host wrote (or a `clientOnly`
   * fragment) mounts in the browser again. Set on first connect.
   */
  origin: "fragment" | "client" | null;
  state: DevElementState;
  mode: HydrateMode;
  listener: ((payload: DropletUpdatePayload) => void) | null;
  /** The props the instance rendered with, after the schema: what a new load runs with. */
  props: Record<string, unknown>;
  /** Whether the instance got `data` as the value (hydrated) or as a promise (mounted). */
  shape: "value" | "promise";
};

const STRATEGIES: readonly string[] = ["hmr", "remount", "reload", "manual"];
const isStrategy = (value: string | null): value is DevStrategy => value !== null && STRATEGIES.includes(value);

const KINDS: readonly string[] = ["component", "load", "contract"];
const isHydrateMode = (value: unknown): value is HydrateMode =>
  value === true || value === false || value === "visible" || value === "interactive";

/** A stylesheet module's update: it replaces itself, under every strategy. */
const STYLESHEET = /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;

/** The URL of a droplet's client module in Vite's HMR updates. */
const CLIENT_MODULE = "virtual:droplet-client?";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A settled promise of `value`, marked so React's `use()` reads it without suspending. */
function settledPromise<T>(value: T): Promise<T> {
  return Object.assign(Promise.resolve(value), { status: "fulfilled", value });
}

/**
 * Adds to `DropletElement` (the entry's `DjsDropletElement`, before it is
 * defined) what it does under `vite dev`, and starts what the page as a
 * whole does: the HMR listeners and, when asked, the dev tool.
 */
export function installDevElement(DropletElement: typeof DjsDropletElement, env: DevElementEnv): void {
  const proto = DropletElement.prototype;
  const hot = import.meta.hot;
  const own = new URL(env.url).origin;
  const strategyKey = `droplets:strategy:${own}`;

  /** The connected elements, for the dev tool. */
  const live = new Set<DjsDropletElement>();
  const states = new WeakMap<DjsDropletElement, DevState>();
  const stateOf = (element: DjsDropletElement): DevState => {
    let state = states.get(element);
    if (!state) {
      state = { origin: null, state: "loading", mode: false, listener: null, props: {}, shape: "value" };
      states.set(element, state);
    }
    return state;
  };

  /** Droplets whose files changed under `manual` and that have not loaded again since. */
  const changed = new Set<string>();
  /** One reload, and one word in the console, however many elements show the droplet. */
  let reloading = false;
  const noted = new Set<string>();
  /** The dev tool's listeners: told whenever what it shows may have changed. */
  const listeners = new Set<() => void>();
  const devNotify = () => {
    for (const listener of listeners) listener();
  };
  const setState = (element: DjsDropletElement, state: DevElementState) => {
    stateOf(element).state = state;
    devNotify();
  };
  const reloadPage = () => {
    if (!reloading) globalThis.location.reload();
    reloading = true;
  };

  /**
   * What an element does when its droplet's files change: the dev tool's
   * choice, else `index.js?strategy=…` on the page's script, else
   * `dev.strategy` of the config. Only `index.js` reads it; nothing changes
   * in what the server sends.
   */
  const activeStrategy = (): DevStrategy => {
    let chosen: string | null = null;
    try {
      chosen = sessionStorage.getItem(strategyKey);
    } catch {
      // Storage blocked: the page's and the config's choice stand.
    }
    if (isStrategy(chosen)) return chosen;
    const asked = new URL(env.url).searchParams.get("strategy");
    if (isStrategy(asked)) return asked;
    if (asked !== null) {
      console.warn(`[droplets] index.js?strategy=${asked}: use hmr, remount, reload or manual; using ${configStrategy}`);
    }
    return configStrategy;
  };

  /**
   * A `droplets:update` from the socket, checked: a known droplet, known
   * fields with the right types, own properties only. `null` otherwise.
   */
  const readUpdate = (value: unknown): DropletUpdatePayload | null => {
    if (!isObject(value) || !Object.hasOwn(value, "droplet")) return null;
    const droplet = value["droplet"];
    if (typeof droplet !== "string" || !env.droplets.has(droplet)) return null;
    const payload: DropletUpdatePayload = { droplet };
    const has = (key: string) => Object.hasOwn(value, key) && value[key] !== undefined;
    if (has("kind")) {
      const kind = value["kind"];
      if (typeof kind !== "string" || !KINDS.includes(kind)) return null;
      payload.kind = kind as NonNullable<DropletUpdatePayload["kind"]>;
    }
    if (has("timestamp")) {
      if (typeof value["timestamp"] !== "number") return null;
      payload.timestamp = value["timestamp"];
    }
    if (has("universal")) payload.universal = value["universal"] === true;
    if (has("hydrate")) {
      if (!isHydrateMode(value["hydrate"])) return null;
      payload.hydrate = value["hydrate"];
    }
    if (has("serverLoad")) {
      if (typeof value["serverLoad"] !== "boolean") return null;
      payload.serverLoad = value["serverLoad"];
    }
    if (payload.kind === "contract") {
      const before = has("before") ? readContract(value["before"]) : null;
      const after = has("after") ? readContract(value["after"]) : null;
      if (!before || !after) return null;
      payload.before = before;
      payload.after = after;
    }
    return payload;
  };

  const followServerLoad = (droplet: string, payload: DropletUpdatePayload) => {
    if (typeof payload.serverLoad !== "boolean") return;
    if (payload.serverLoad) env.serverLoad.add(droplet);
    else env.serverLoad.delete(droplet);
  };

  const followHydrate = (droplet: string, hydrate: HydrateMode) => {
    if (hydrate === false) env.hydration.delete(droplet);
    else env.hydration.set(droplet, hydrate);
  };

  /**
   * How the element reached the page. A server fragment carries its context
   * (`[data-droplet-context]` or `data-context`); a `clientOnly` one has
   * neither markup nor data for a droplet that hydrates, as an element the
   * host wrote itself.
   */
  const arrival = (element: DjsDropletElement, droplet: string): "fragment" | "client" => {
    const fromServer = element._readInline("[data-droplet-context]").found || element.dataset["context"] !== undefined;
    if (!fromServer) return "client";
    const markup = element.querySelector(":scope > [data-droplet-entry]")?.childNodes.length ?? 0;
    const clientOnly = env.hydration.has(droplet) && markup === 0 && !element._readInline("[data-droplet-data]").found;
    return clientOnly ? "client" : "fragment";
  };

  const original = {
    connectedCallback: proto.connectedCallback,
    teardown: proto._teardown,
    pruneChildren: proto._pruneChildren,
    modeOf: proto._modeOf,
    waitFor: proto._waitFor,
    start: proto._start,
    importModule: proto._importModule,
    updateForm: proto.updateForm,
  };

  proto.connectedCallback = async function (this: DjsDropletElement): Promise<boolean> {
    const droplet = this.dataset["droplet"];
    if (!this._connected && droplet && env.droplets.has(droplet)) {
      const state = stateOf(this);
      state.origin ??= arrival(this, droplet);
      live.add(this);
      devNotify();
    }
    const started = await original.connectedCallback.call(this);
    if (started && droplet && hot) subscribe(this, droplet);
    return started;
  };

  proto._teardown = function (this: DjsDropletElement): Promise<void> {
    if (live.delete(this)) devNotify();
    const state = states.get(this);
    if (state?.listener && hot) {
      hot.off("droplets:update", state.listener);
      state.listener = null;
    }
    return original.teardown.call(this);
  };

  proto._pruneChildren = function (this: DjsDropletElement): void {
    for (const node of Array.from(this.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if ((node as Element).matches(env.allowedChildren)) continue;
        console.warn(
          `[droplets] <${env.elementName}> takes its children in one <div data-droplet-slot>; removed a loose <${(node as Element).localName}>`,
          node,
        );
      } else if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "") {
        console.warn(`[droplets] <${env.elementName}> takes its children in one <div data-droplet-slot>; removed loose text`, node);
      }
    }
    original.pruneChildren.call(this);
  };

  proto._modeOf = function (this: DjsDropletElement, flag: HydrateMode, hasMarkup: boolean): HydrateMode {
    const asked = this.dataset["hydrate"];
    if (flag !== false && asked !== undefined && !["", "true", "false", "visible", "interactive"].includes(asked)) {
      console.warn(`[droplets] data-hydrate="${asked}": use true, false, visible or interactive; using the droplet's own`);
    }
    if (asked === "false" && env.scripts.has(this.dataset["droplet"] ?? "")) {
      console.warn(
        `[droplets] data-hydrate="false" on the script droplet "${this.dataset["droplet"]}" is ignored: a script droplet only runs in the browser`,
      );
    }
    return original.modeOf.call(this, flag, hasMarkup);
  };

  proto._waitFor = async function (this: DjsDropletElement, ...args: Parameters<DjsDropletElement["_waitFor"]>): Promise<boolean> {
    setState(this, "waiting");
    const ready = await original.waitFor.apply(this, args);
    if (ready) setState(this, "loading");
    return ready;
  };

  proto._start = async function (
    this: DjsDropletElement,
    droplet: string,
    contentRoot: HTMLElement,
    run: number,
    cacheBust: boolean,
  ): Promise<boolean | undefined> {
    const isError = this.dataset["dropletError"] !== undefined;
    const hasMarkup = contentRoot.childNodes.length > 0;
    const flag = env.hydration.get(droplet);
    // The unwrapped `_modeOf`: the element's own call warns, once.
    stateOf(this).mode = flag === undefined ? false : original.modeOf.call(this, flag, hasMarkup);
    setState(this, "loading");
    const rendered = await original.start.call(this, droplet, contentRoot, run, cacheBust);
    if (rendered !== undefined) {
      setState(
        this,
        rendered ? (isError ? "error" : hasMarkup ? "hydrated" : "mounted") : contentRoot.childNodes.length > 0 ? "static" : "empty",
      );
    }
    return rendered;
  };

  // What the droplet rendered with, for a load edit: its props after the
  // schema, and whether `data` was the value or a promise.
  proto._importModule = async function (this: DjsDropletElement, droplet: string, cacheBust: boolean): Promise<DevClientModule | null> {
    const mod: DevClientModule | null = await original.importModule.call(this, droplet, cacheBust);
    const render = mod?.default;
    if (!mod || !render) return mod;
    const element = this;
    return {
      ...mod,
      default(target, data, children, info) {
        const state = stateOf(element);
        state.props = info.props ?? {};
        state.shape = typeof (data as PromiseLike<unknown> | null)?.then === "function" ? "promise" : "value";
        return render(target, data, children, info);
      },
    };
  };

  proto.updateForm = async function (this: DjsDropletElement, form: unknown): Promise<void> {
    const hydrated = this.actionTarget() !== null && this._hydrated;
    const done = original.updateForm.call(this, form);
    const run = this._run;
    await done;
    if (hydrated && run === this._run) setState(this, this._hydrated ? "mounted" : "empty");
  };

  /**
   * The remount: the registries follow the payload, and the droplet loads
   * again by its flags as they are now, the way it reached the page. A
   * server fragment is asked for again with the same context, and hydrates,
   * or stays as the server rendered it; an element the host wrote mounts in
   * the browser. The host's children are carried over.
   */
  async function update(this: DjsDropletElement, payload: DropletUpdatePayload): Promise<void> {
    const droplet = this.dataset["droplet"];
    if (!droplet || payload.droplet !== droplet) return;
    if (payload.hydrate !== undefined) followHydrate(droplet, payload.hydrate);
    followServerLoad(droplet, payload);
    if (!this._connected) return;

    const run = ++this._run;
    this._stopWaiting?.();
    if (changed.delete(droplet)) devNotify();
    this._dataRequest = null;
    this._dropClicks();
    const contentRoot = this._contentRoot();
    const origin = stateOf(this).origin;
    // Asked first: an answer that is no fragment leaves the droplet as it is.
    const fresh = origin === "fragment" ? await this._fetchFragment(droplet) : null;
    if (run !== this._run || (origin === "fragment" && !fresh)) return;
    await this._swap(droplet, contentRoot, fresh, run, true);
  }
  Object.defineProperty(proto, "update", { value: update, writable: true, configurable: true });

  /**
   * An edit under the `hmr` strategy. A component edit is the framework's
   * HMR (or the client module's fallback, a remount in place) for a droplet
   * live in the browser; one that is not (server markup that does not
   * hydrate, or not yet) gets the server's new markup. A load edit brings
   * the live component new data; a new render contract leaves the droplet
   * as it is, but for `hydrate` turning on.
   */
  const hotUpdate = async (element: DevDropletElement, droplet: string, payload: DropletUpdatePayload): Promise<void> => {
    if (payload.kind === "contract") return hotContract(element, droplet, payload);
    if (payload.kind === "load") return hotData(element, droplet, payload);
    if (!element._hydrated) return element.update(payload);
  };

  /**
   * The loads ran again (`_data`, then `+droplet.ts`), and the live
   * instance renders with their data through its renderer's `update`,
   * keeping its state. Anything it cannot take that way (no instance, no
   * `update`, an error page, a load that fails) loads again as a remount.
   */
  const hotData = async (element: DevDropletElement, droplet: string, payload: DropletUpdatePayload): Promise<void> => {
    followServerLoad(droplet, payload);
    if (!element._connected) return;
    const handle = element._instance;
    if (!element._hydrated || !handle || element.dataset["dropletError"] !== undefined) return element.update(payload);
    const run = ++element._run;
    element._dataRequest = null;
    // A new `+droplet.ts`: a fresh client module, for its load. The
    // component module is the same one, at the same URL.
    const mod: DevClientModule | null = await element._importModule(droplet, payload.universal === true);
    if (run !== element._run) return;
    if (!mod?.update) return element.update(payload);
    const { props, shape } = stateOf(element);
    let value: unknown;
    try {
      const answer: Payload = env.serverLoad.has(droplet)
        ? await element._serverData(droplet, { host: element._context.host, props }, true)
        : { data: undefined };
      if (run !== element._run) return;
      if (answer.failed) return element.update(payload);
      const host = withoutFormResults(element._host ?? new URL(env.pageUrl()));
      value = await settle(mod.load ? mod.load({ host, props, data: answer.data }) : answer.data);
    } catch (error) {
      if (run !== element._run) return;
      if (error instanceof env.nothingToRender) {
        if (!(error instanceof env.staleBuild)) console.error(`[droplets] ${droplet}:`, (error as Error).message);
        return;
      }
      // A load that throws: the remount shows the error page.
      return element.update(payload);
    }
    if (run !== element._run) return;
    const kept = await mod.update(handle, shape === "promise" ? settledPromise(value) : value);
    if (run !== element._run) return;
    if (!kept) return element.update(payload);
  };

  /**
   * The droplet's `ssr`, `hydrate` or `prerender` changed. The registries
   * follow; the element does not, but for `hydrate` turning on, which
   * hydrates the markup there in the new mode, and a new mode while it
   * still waits, which it then waits in. The page's notice is shown once
   * per droplet, by `onContract`.
   */
  const hotContract = async (element: DevDropletElement, droplet: string, payload: DropletUpdatePayload): Promise<void> => {
    const { before, after } = payload;
    if (!before || !after) return;
    followHydrate(droplet, after.hydrate);
    followServerLoad(droplet, payload);
    if (!element._connected) return;
    const contentRoot = element._contentRoot();
    const hasMarkup = contentRoot.childNodes.length > 0;
    const life: ElementLife = element._hydrated ? "live" : element._stopWaiting ? "waiting" : "static";
    const action = hydrateAction(original.modeOf.call(element, before.hydrate, hasMarkup), element._modeOf(after.hydrate, hasMarkup), life);
    if (action === "hydrate" && !element._readInline("[data-droplet-data]").found) {
      // Markup that was never to hydrate came without its data: the server
      // renders it again with the data inline, and that hydrates.
      return element.update(payload);
    }
    if (action === "hydrate" || action === "rewait") {
      const run = ++element._run;
      element._stopWaiting?.();
      element._dropClicks();
      await element._start(droplet, contentRoot, run, true);
    }
  };

  /**
   * The plugin sends `droplets:update` over Vite's HMR socket when a file a
   * droplet depends on changes; what the element does is the page's
   * strategy. Updates only arrive from the origin that served this script.
   */
  function subscribe(element: DjsDropletElement, droplet: string): void {
    if (!hot) return;
    const dev = element as DevDropletElement;
    const listener = (raw: unknown) => {
      const payload = readUpdate(raw);
      if (!payload || payload.droplet !== droplet) return;
      const strategy = activeStrategy();
      if (strategy === "reload") return reloadPage();
      if (strategy === "manual") {
        if (!noted.has(droplet)) console.info(`[droplets] ${droplet} changed; reload the page to see it`);
        noted.add(droplet);
        queueMicrotask(() => noted.delete(droplet));
        changed.add(droplet);
        devNotify();
        return;
      }
      const done = strategy === "hmr" && payload.kind ? hotUpdate(dev, droplet, payload) : dev.update(payload);
      done.catch((error: unknown) => {
        console.error("[droplets] failed to handle hmr event", error);
      });
    };
    stateOf(element).listener = listener;
    hot.on("droplets:update", listener);
  }

  const devElements = (): DevElementInfo[] =>
    Array.from(live)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map((element) => {
        const state = stateOf(element);
        return {
          element,
          droplet: element.dataset["droplet"] ?? "",
          state: state.state,
          hydrate: state.mode,
          changed: changed.has(element.dataset["droplet"] ?? ""),
        };
      });
  Object.defineProperty(DropletElement, "devElements", { value: devElements, writable: true, configurable: true });

  /** Remounts the live elements of `droplet`; how many. */
  const remountLive = (droplet: string): number => {
    let count = 0;
    for (const element of live) {
      if (element.dataset["droplet"] !== droplet || !element._hydrated) continue;
      count++;
      (element as DevDropletElement).update({ droplet }).catch((error: unknown) => console.error("[droplets] remount failed", error));
    }
    return count;
  };
  const shows = (droplet: string): boolean => {
    for (const element of live) if (element.dataset["droplet"] === droplet) return true;
    return false;
  };

  /** What the dev tool reads from, and asks of, this loader. */
  const toolSource = (): DevToolSource => ({
    origin: env.location() ?? own,
    element: env.elementName,
    strategy: activeStrategy,
    setStrategy: (strategy) => {
      try {
        sessionStorage.setItem(strategyKey, strategy);
      } catch {
        // Storage blocked: the choice lasts until the page reloads.
      }
      devNotify();
    },
    elements: devElements,
    remount: (element) => {
      const droplet = element.dataset["droplet"];
      if (droplet && element instanceof DropletElement) {
        (element as DevDropletElement).update({ droplet }).catch((error: unknown) => console.error("[droplets] remount failed", error));
      }
    },
    reload: () => globalThis.location.reload(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  /** The page's notice of a droplet's new render contract, once per edit, when the page shows it. */
  const onContract = (payload: DropletUpdatePayload, shown: Set<string>): void => {
    const { droplet, before, after, timestamp } = payload;
    if (!before || !after || !shows(droplet)) return;
    const key = `${timestamp} ${droplet}`;
    if (shown.has(key)) return;
    shown.add(key);
    const notice = contractNotice(droplet, before, after);
    if (!notice) return;
    if (!notice.toast) {
      console.info(`[droplets] ${notice.message}. ${notice.detail}`);
      return;
    }
    // A later change of the same flags replaces this notice (ssr off, then on
    // again: the newer one); a change of another flag shows next to it.
    const flags = contractChanges(before, after)
      .map((change) => change.flag)
      .join(",");
    notify(
      { key: `${own} ${droplet} contract ${flags}`, message: notice.message, detail: notice.detail, reload: notice.reload },
      reloadPage,
    );
  };

  /**
   * What the page as a whole does about an edit, once per loader.
   *
   * - Under `hmr`, a new render contract gets its notice (`onContract`),
   *   and an edit no framework module took (the client module's
   *   `droplets:hot-fallback`) remounts the live droplet in place.
   * - Under any other strategy, Vite's module updates for an edit to a
   *   droplet are dropped before they run, stylesheets aside: the elements
   *   follow `droplets:update` as that strategy says.
   * - `src/hooks.client.ts` changed: under `hmr` a notice with "Reload
   *   page", under `manual` a console line; `remount` and `reload` reload.
   */
  const followHotUpdates = (hot: NonNullable<ImportMeta["hot"]>): void => {
    /** Timestamps of edits to droplets that Vite's updates for are not this page's to run. */
    const held = new Set<number>();
    /** Contract notices already shown, per edit and droplet. */
    const shown = new Set<string>();

    hot.on("droplets:update", (raw) => {
      const payload = readUpdate(raw);
      if (!payload || payload.timestamp === undefined) return;
      if (activeStrategy() !== "hmr") {
        held.add(payload.timestamp);
        return;
      }
      if (payload.kind === "contract") onContract(payload, shown);
    });

    hot.on("vite:beforeUpdate", (update) => {
      // The same payload Vite applies next: what is left in it runs.
      const selfAccepted = new Set(update.updates.filter((one) => one.path === one.acceptedPath).map((one) => one.path));
      const kept = update.updates.filter((one) => {
        if (held.has(one.timestamp)) return one.type === "css-update" || STYLESHEET.test(one.acceptedPath);
        // A module that accepts some of its exports only (Svelte's
        // `acceptExports(["default"])`, next to a `<script module>`'s flags)
        // also reaches the client module, which imports all of them: its own
        // HMR has the edit, and the client module's fallback stays out of it.
        return !(one.path.startsWith(CLIENT_MODULE) && one.path !== one.acceptedPath && selfAccepted.has(one.acceptedPath));
      });
      for (const one of update.updates) held.delete(one.timestamp);
      update.updates.splice(0, update.updates.length, ...kept);
    });

    hot.on("droplets:hooks-client", (raw) => {
      if (!isObject(raw) || raw["reason"] !== "hooks.client") return;
      const strategy = activeStrategy();
      if (strategy === "manual") return console.info("[droplets] src/hooks.client.ts changed; reload the page to run its init again");
      if (strategy !== "hmr") return reloadPage();
      notify(
        {
          key: `${own} hooks.client`,
          message: "src/hooks.client.ts changed",
          detail: "Its init runs once per page, before any droplet starts: reload the page to run it again.",
          reload: true,
        },
        reloadPage,
      );
    });

    globalThis.addEventListener("droplets:hot-fallback", (event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (!isObject(detail) || !Object.hasOwn(detail, "droplet") || !Object.hasOwn(detail, "origin")) return;
      const { droplet, origin } = detail;
      if (typeof droplet !== "string" || !env.droplets.has(droplet) || origin !== own) return;
      if (activeStrategy() !== "hmr") return;
      if (remountLive(droplet) > 0) {
        console.info(`[droplets] ${droplet}: no HMR of its framework took this edit; remounted in place`);
      }
    });
  };

  /**
   * The dev tool, for `dev.injectTool` or `index.js?injectTool=true`
   * (`false` turns it off for the page). The tool's module comes from this
   * server; the first one on the page creates the tool, each registers.
   */
  const injectDevTool = async (): Promise<void> => {
    if (!toolUrl) {
      console.warn("[droplets] injectTool: the dev tool comes with @dropletsjs/devtools; add dropletsDevtools() to the Vite plugins");
      return;
    }
    try {
      await import(/* @vite-ignore */ new URL(toolUrl, env.url).href);
      (globalThis as { DropletsDevTools?: DropletsDevTools }).DropletsDevTools?.register(toolSource());
    } catch (error) {
      console.error("[droplets] could not load the dev tool", error);
    }
  };

  const asked = new URL(env.url).searchParams.get("injectTool");
  if (asked === null ? configInjectTool : asked !== "false") void injectDevTool();
  if (hot) followHotUpdates(hot);
}

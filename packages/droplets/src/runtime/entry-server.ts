import droplets, { api, hooks, importMapModule, publicEnvNames } from "virtual:droplets";
import { readRuntimeEnv } from "./env-store.ts";
import { logger } from "../core/logger.ts";
import type {
  ComponentKind,
  ComponentModule,
  HydrateMode,
  RendererServerModule,
  RenderProps,
  ServerRenderOutput,
} from "../renderer.ts";
import type { DropletMeta, DropletPayload, RenderResult } from "./app.ts";
import {
  checkLoadResult,
  DropletRenderError,
  runHandleError,
  settle,
  toWireError,
  UnhandledDropletError,
} from "./load.ts";
import { ACTION_NAME, actionUrlFor } from "./form.ts";
import { parseHost } from "./host.ts";
import { PropsError, prerenderKey, propsKey, validateProps } from "./props.ts";
import { requestInfo, withRequestInfo } from "./request-store.ts";
import { matchRoute, type ApiMatch, type ApiRoute } from "./routes.ts";
import {
  HttpError,
  isHostUrlPropsErrorInPrerender,
  isHttpError,
  isRedirect,
  type DropletLoadEvent,
  type Handle,
  type HandleServerError,
  type ImportMapHandler,
  type Action,
  type LoadEvent,
  type TransformEvent,
  type TransformInput,
} from "./server.ts";

type ServerLoad = (event: LoadEvent) => unknown;

/** What `+droplet.server.ts` may export. */
type ServerModule = {
  load?: ServerLoad;
  handleError?: unknown;
  entries?: () => unknown;
  transform?: TransformInput;
  actions?: unknown;
};
type ClientLoad = (event: DropletLoadEvent) => unknown;

/** What `+droplet.ts` may export: `load`, `handleError` and the `props` schema. */
type UniversalModule = { load?: ClientLoad; handleError?: unknown; props?: unknown };

type DropletRegistryEntry = {
  /** The component module, as its renderer's Vite plugin compiled it. */
  component?: ComponentModule;
  /** The server side of the renderer that handles `component`. */
  renderer?: RendererServerModule;
  ssr?: boolean;
  hydrate?: HydrateMode;
  prerender?: boolean;
  load?: () => Promise<UniversalModule>;
  serverLoad?: () => Promise<ServerModule>;
  /** The error page module, in the droplet's framework; it follows the droplet's flags. */
  error?: ComponentModule;
};

/** By droplet id: a name from a URL only ever finds a droplet (`__proto__` finds nothing). */
const registry = new Map(Object.entries(droplets as Record<string, DropletRegistryEntry>));
const apiRoutes = api as ApiRoute[];

function getEntry(name: string): DropletRegistryEntry | null {
  return registry.get(name) ?? null;
}

/** Short and unique enough per page; runtime-neutral (no `node:crypto`). */
function createRenderId(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Renders a component through its renderer. The `children` value the
 * component receives outputs the `[data-app-children]` marker, where the
 * element puts the host's children in the browser; the renderer builds it.
 */
async function renderWith(
  renderer: RendererServerModule | undefined,
  module: ComponentModule,
  props: RenderProps,
  droplet: string,
  kind: ComponentKind,
  dropletProps: Record<string, unknown>,
): Promise<{ html: string; head: string | undefined; renderId: string }> {
  if (!renderer || typeof renderer.render !== "function") {
    throw new Error(`${droplet}: the ${kind} component has no renderer; the server registry is stale`);
  }
  const renderId = createRenderId();
  // The request's public location: a trusted `x-host`, never an untrusted one; a token at build.
  const info = requestInfo();
  const actionUrl = actionUrlFor(info?.origin ?? "", droplet, dropletProps, info?.page);
  const context = { droplet, kind, renderId, actionUrl };
  // For `actionUrl()` of `$droplets/form`, anywhere the render calls it.
  const output: ServerRenderOutput = info
    ? await withRequestInfo({ ...info, render: { droplet, props: dropletProps } }, () =>
      renderer.render(module, props, context))
    : await renderer.render(module, props, context);
  if (typeof output === "string") return { html: output, head: undefined, renderId };
  if (typeof output?.html !== "string") {
    throw new Error(`${droplet}: the renderer must return HTML as a string or { html, head }`);
  }
  return { html: output.html, head: output.head, renderId };
}

/**
 * `error()` and `redirect()` are answers, not failures: they skip
 * `handleError`. So does a read of `host` the build cannot serve: it stops
 * the build instead of becoming the error page.
 */
function isAnswer(error: unknown): boolean {
  return isHttpError(error) || isRedirect(error) || isHostUrlPropsErrorInPrerender(error);
}

/** Whether a droplet exists, and how it wants to be rendered. */
export function getDropletMeta(name: string): DropletMeta {
  const entry = getEntry(name);
  if (!entry?.component) {
    logger.debug("framework", "unknown droplet", {
      droplet: name,
      known: [...registry.keys()],
    });
    return { exists: false, ssr: true };
  }
  return {
    exists: true,
    ssr: entry.ssr ?? true,
    hydrate: entry.hydrate ?? true,
    ...(entry.prerender ? { prerender: true } : {}),
  };
}

/**
 * Runs the `props` schema from `+droplet.ts` over the caller's props. Props
 * that do not match answer 400, before any load runs.
 */
export async function validateDropletProps(
  name: string,
  props: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const mod = await getEntry(name)?.load?.();
  try {
    return await validateProps(name, mod?.props, props);
  } catch (error) {
    if (error instanceof PropsError) throw new HttpError(400, error.message);
    throw error;
  }
}

/** One render to make at build, as `entries` asked for it. */
export type BuildEntry = { props: Record<string, unknown>; host?: string };

const ENTRY_KEYS = new Set(["props", "host"]);

/**
 * The renders to make at build: `entries` from `+droplet.server.ts`, or
 * `[{}]`. Each is an event, `{ props?, host? }`; `host` comes back as an
 * absolute URL string.
 */
export async function getEntries(name: string): Promise<BuildEntry[]> {
  const mod = await getEntry(name)?.serverLoad?.();
  if (typeof mod?.entries !== "function") return [{ props: {} }];
  const entries: unknown = await mod.entries();
  if (!Array.isArray(entries)) {
    throw new Error(`${name}: entries() must return an array of events, e.g. [{ props: { page: 1 } }]`);
  }
  return entries.map((entry: unknown): BuildEntry => {
    const shape = typeof entry === "object" && entry !== null && !Array.isArray(entry)
      ? Object.keys(entry).filter((key) => !ENTRY_KEYS.has(key))
      : null;
    if (!shape || shape.length > 0) {
      throw new Error(
        `${name}: entries() returns events, { props?, host? }; got ${JSON.stringify(entry)}. Props go under props: [{ props: { page: 1 } }]`,
      );
    }
    const { props, host } = entry as { props?: unknown; host?: unknown };
    if (props !== undefined && (typeof props !== "object" || props === null || Array.isArray(props))) {
      throw new Error(`${name}: an entry's props must be an object, got ${JSON.stringify(props)}`);
    }
    if (host === undefined) return { props: (props ?? {}) as Record<string, unknown> };
    const url = parseHost(host);
    if (!url) throw new Error(`${name}: an entry's host must be an absolute URL, got ${JSON.stringify(String(host))}`);
    return { props: (props ?? {}) as Record<string, unknown>, host: url.href };
  });
}

/**
 * Runs the droplet's `transform` (one function or a list, in order) over its
 * rendered HTML, prerendered or live. Without one, the HTML is unchanged.
 */
export async function transformDroplet(name: string, event: TransformEvent): Promise<string> {
  const mod = await getEntry(name)?.serverLoad?.();
  const transform = mod?.transform;
  if (!transform) return event.html;
  let html = event.html;
  for (const step of Array.isArray(transform) ? transform : [transform]) {
    const result: unknown = await step({ ...event, html });
    if (typeof result !== "string") {
      throw new Error(`${name}: transform must return the HTML as a string`);
    }
    html = result;
  }
  return html;
}

/**
 * Runs the load of `+droplet.server.ts`, settled: its fields that are
 * promises resolved. The result is what gets inlined for the client.
 */
async function runServerLoad(name: string, event: LoadEvent): Promise<unknown> {
  const mod = await getEntry(name)?.serverLoad?.();
  if (typeof mod?.load !== "function") return undefined;
  return settle(checkLoadResult(name, "+droplet.server.ts", await mod.load(event)));
}

/**
 * A load threw: the error goes through `handleError` in `+droplet.server.ts`
 * and comes out as it leaves the server. Without `+error.*`, or when
 * `handleError` throws, there is nothing to show: unhandled.
 */
async function serverFailure(name: string, error: unknown): Promise<{ failed: true; error: unknown }> {
  logger.error("drop", "droplet load failed", { droplet: name, error });
  const entry = getEntry(name);
  if (!entry?.error) {
    throw new UnhandledDropletError(name, "load failed and there is no error page (+error.*)", error);
  }
  try {
    const mod = await entry.serverLoad?.();
    // Without a handleError of its own, a production server shows no more
    // than "Internal Error": what a driver or a query said stays in the log.
    const shown = typeof mod?.handleError !== "function" && !import.meta.env.DEV
      ? new DropletRenderError()
      : await runHandleError(name, "+droplet.server.ts", mod?.handleError, error);
    return { failed: true, error: toWireError(shown) };
  } catch (handleError) {
    throw new UnhandledDropletError(name, "handleError in +droplet.server.ts threw", handleError);
  }
}

/**
 * The server load alone, for `_data` and fragments without HTML: `{ data }`,
 * or `{ failed, error }` once `handleError` in `+droplet.server.ts` ran.
 * `error()` and `redirect()` are thrown on, to be answered as they are.
 */
export async function loadDropletData(name: string, event: LoadEvent): Promise<DropletPayload> {
  try {
    return { data: await runServerLoad(name, event) };
  } catch (error) {
    if (isAnswer(error)) throw error;
    return serverFailure(name, error);
  }
}

/**
 * The lookup keys of the renders `entries` lists, after the schema: which
 * props, for which host, have a prerendered render. `fallbackHost` is what
 * an entry without `host` renders for (`prerender.host`, `PUBLIC_URL`);
 * without one, the render is host-agnostic.
 */
export async function prerenderKeys(name: string, fallbackHost?: string): Promise<string[]> {
  const keys: string[] = [];
  for (const entry of await getEntries(name)) {
    const host = parseHost(entry.host ?? fallbackHost) ?? undefined;
    keys.push(prerenderKey(propsKey(await validateDropletProps(name, entry.props)), host));
  }
  return keys;
}

/**
 * Runs the load of `+droplet.ts`, which shapes server data into the
 * component's `data`, settled as the browser settles it before hydrating.
 */
async function runUniversalLoad(name: string, event: LoadEvent, serverData: unknown): Promise<unknown> {
  const mod = await getEntry(name)?.load?.();
  if (typeof mod?.load !== "function") return serverData;
  const result = await mod.load({ host: event.host, props: event.props, data: serverData });
  return settle(checkLoadResult(name, "+droplet.ts", result));
}

/** An action name as `?/name` gives it: a plain identifier, never a key of `Object.prototype`. */
const FORBIDDEN_ACTION_NAMES = new Set(["__proto__", "constructor", "prototype"]);

/** An object literal: its prototype is `Object.prototype` or `null`, nothing a class or a proxy chose. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * The form action `action` of a droplet: `"none"` when `+droplet.server.ts`
 * exports no `actions`, `"missing"` when it has no own function by that
 * name. Only the exported object's own keys count, so a name from the URL
 * never reaches anything else. `actions` must be a plain object.
 */
export async function findAction(name: string, action: string): Promise<Action | "none" | "missing"> {
  const mod = await getEntry(name)?.serverLoad?.();
  const actions = mod?.actions;
  if (actions === undefined) return "none";
  if (!isPlainObject(actions)) {
    throw new Error(`${name}: actions in +droplet.server.ts must be a plain object of functions, { default, add, … }`);
  }
  if (!ACTION_NAME.test(action) || FORBIDDEN_ACTION_NAMES.has(action) || !Object.hasOwn(actions, action)) {
    return "missing";
  }
  const found = actions[action];
  return typeof found === "function" ? (found as Action) : "missing";
}

/** What a render may carry besides the event: an action's result, as the component's `form`. */
export type RenderOptions = { form?: unknown };

/**
 * The full server-side chain: server load, then `+droplet.ts`, then the
 * renderer. A load or the render that throws gives `{ failed, error }`
 * instead, for the error page. Returns `null` for an unknown droplet.
 */
export async function renderDroplet(
  name: string,
  event: LoadEvent,
  options: RenderOptions = {},
): Promise<RenderResult | null> {
  const entry = getEntry(name);
  if (!entry?.component) return null;

  let serverData: unknown;
  try {
    serverData = await runServerLoad(name, event);
    const data = await runUniversalLoad(name, event, serverData);
    const props = options.form === undefined ? { data } : { data, form: options.form };
    const { html, head, renderId } = await renderWith(entry.renderer, entry.component, props, name, "droplet", event.props);
    logger.debug("framework", "rendered droplet", { droplet: name, bodyLength: html.length });
    return { body: html, html, data, serverData, renderId, ...(head === undefined ? {} : { head }) };
  } catch (error) {
    if (isAnswer(error)) throw error;
    return serverFailure(name, error);
  }
}

/**
 * Renders the error page for an error as it left the server: through
 * `handleError` in `+droplet.ts` first, as the browser does. `props` are the
 * droplet's, for its `actionUrl()`. `null` when the droplet has no error page.
 */
export async function renderError(
  name: string,
  error: unknown,
  props: Record<string, unknown> = {},
): Promise<RenderResult | null> {
  const entry = getEntry(name);
  if (!entry?.error) return null;
  let shown: unknown;
  try {
    const mod = await entry.load?.();
    shown = await runHandleError(name, "+droplet.ts", mod?.handleError, error);
  } catch (handleError) {
    throw new UnhandledDropletError(name, "handleError in +droplet.ts threw", handleError);
  }
  const { html, head, renderId } = await renderWith(
    entry.renderer,
    entry.error,
    { error: shown },
    name,
    "error",
    props,
  );
  return { body: html, html, renderId, ...(head === undefined ? {} : { head }) };
}

/** The public variables read at runtime, with their values now: `/index.js` hands them to the page. */
export function publicEnv(): Record<string, string | undefined> {
  return Object.fromEntries(publicEnvNames.map((name) => [name, readRuntimeEnv(name)]));
}

/**
 * An optional export, read by name: `hooks.handleError` written out makes
 * the bundler warn (IMPORT_IS_UNDEFINED) for every hooks file that leaves it out.
 */
function optionalExport(module: object, name: string): unknown {
  return (module as Record<string, unknown>)[name];
}

/** The `handle` export of `src/hooks.server.ts`, when there is one. */
export function getHandle(): Handle | undefined {
  const handle = optionalExport(hooks, "handle");
  return typeof handle === "function" ? (handle as Handle) : undefined;
}

/** The `handleError` export of `src/hooks.server.ts`, when there is one. */
export function getHandleError(): HandleServerError | undefined {
  const handleError = optionalExport(hooks, "handleError");
  return typeof handleError === "function" ? (handleError as HandleServerError) : undefined;
}

/** The `importmap` export of `src/importmap.server.ts`, when there is one. */
export function getImportMap(): ImportMapHandler | undefined {
  const importmap = (importMapModule as { importmap?: unknown }).importmap;
  return typeof importmap === "function" ? (importmap as ImportMapHandler) : undefined;
}

/** The `+server.ts` answering `pathname`. */
export function matchApi(pathname: string): ApiMatch | null {
  return matchRoute(apiRoutes, pathname);
}

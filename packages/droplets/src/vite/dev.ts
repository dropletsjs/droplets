import { relative, sep } from "node:path";
import { isRunnableDevEnvironment } from "vite";
import type { DevEnvironment, EnvironmentModuleNode, ViteDevServer } from "vite";
import { type DropletEntry, discoverDroplets, dropletId } from "../core/discover.ts";
import { logger } from "../core/logger.ts";
import { entryServerPath, toViteFsPath } from "../core/paths.ts";
import { CORE_SUFFIXES } from "../renderer.ts";
import {
  createDropletsApp,
  type DropletsApp,
  isActionDataError,
  type GetDropletMeta,
  type LoadClientModule,
  type LoadDropletData,
  type RenderDroplet,
} from "../runtime/app.ts";
import type { HandleServerError, ImportMap, ImportMapHandler } from "../runtime/server.ts";
import type { SsrModule } from "../server/app.ts";
import { createDevLog } from "../runtime/dev-log.ts";
import { withoutRequestInfo } from "../runtime/request-store.ts";
import { locationScript, publicEnvScript, serverKey } from "../runtime/server-records.ts";
import { PUBLIC_PATH, publicFileHandler } from "./assets.ts";
import { withViteIdAliases } from "./externalize.ts";
import { checkImportMap } from "./importmap-check.ts";
import { loadIndexHtml } from "./index-html.ts";
import { externalsList, type PluginState } from "./state.ts";
import { syncTypes } from "./sync-types.ts";
import { clientEntryId, RESOLVED_VIRTUAL_DROPLETS } from "./virtual.ts";
import { replacers } from "../runtime/host-tokens.ts";

/**
 * `handleError` under `vite dev`: a form action's data that cannot travel
 * as JSON is the developer's bug, so the answer names it, not only the log.
 * Kept out of the runtime app, which production servers bundle.
 */
export type DevHandleErrorInput = { handleError: HandleServerError | undefined };

export function devHandleError({ handleError }: DevHandleErrorInput): HandleServerError {
  return (input) => (isActionDataError(input.error) ? { message: input.error.message } : handleError?.(input));
}

type DevContext = { host: string; props: Record<string, unknown> };

type WithDevContextInput = { response: Response; context: DevContext };

/**
 * A fragment without context (a droplet with `hydrate = false`, which a
 * production fragment leaves bare) gets it on `data-droplet-context` under
 * `vite dev`, for the dev remount to ask for it again with the same props
 * and host. Here, not in the runtime app: production servers bundle that.
 */
export async function withDevContext({ response, context }: WithDevContextInput): Promise<Response> {
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  // Gzipped by the app for a client that takes it: edited as text, it goes out plain.
  const html =
    response.headers.get("content-encoding") === "gzip" && response.body
      ? await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).text()
      : await response.text();
  const open = /^<[a-z][\w-]*\s[^>]*\bdata-droplet="[^"]*"[^>]*>/.exec(html)?.[0];
  const carries =
    open === undefined ||
    open.includes(" data-droplet-context=") ||
    html.startsWith('<script type="application/text" data-droplet-payload="context">', open.length);
  const json = JSON.stringify(context).replace(/</g, "\\u003c");
  const body = carries
    ? html
    : `${open.slice(0, -1)} data-droplet-context="${Buffer.from(json, "utf8").toString("base64")}">${html.slice(open.length)}`;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export type TransformImportMapInput = { map: ImportMap; externals: string[] };

type DevImportMapInput = {
  handler: ImportMapHandler | undefined;
  transform: (input: TransformImportMapInput) => ImportMap;
};

/** `importmap` under `vite dev`, its map passed through `transform`; anything else is left for the app to refuse. */
export function devImportMap({ handler, transform }: DevImportMapInput): ImportMapHandler | undefined {
  if (!handler) return undefined;
  return async (event) => {
    const externals = [...event.externals];
    const map: unknown = await handler(event);
    return typeof map === "object" && map !== null && !Array.isArray(map)
      ? transform({ map: map as ImportMap, externals })
      : (map as ImportMap);
  };
}

type NormalizePathInput = { value: string };

function normalizePath({ value }: NormalizePathInput): string {
  return value.replace(/\\/g, "/");
}

/**
 * `/src/droplets/hello-world/+droplet.svelte` -> `hello-world`; a folder
 * that is not lowercase kebab-case is no droplet (`null`). With
 * `extensions`, only component suffixes a renderer handles match; without,
 * any suffix that is not a load file's (`+droplet.ts`, `+droplet.server.ts`).
 */
export type ExtractDropletIdFromModuleIdInput = { id: string; extensions?: readonly string[] | undefined };

export function extractDropletIdFromModuleId({ id, extensions }: ExtractDropletIdFromModuleIdInput): string | null {
  const match = normalizePath({ value: id.split("?")[0] ?? "" }).match(/\/([^/]+)\/\+[Dd]roplet(\.[^/]+)$/);
  if (!match?.[1] || !match[2]) return null;
  const suffix = match[2];
  if (CORE_SUFFIXES.has(suffix)) return null;
  if (extensions && !extensions.includes(suffix)) return null;
  return dropletId({ folderName: match[1] });
}

/** The droplet folder a file belongs to, if it is inside the droplets root. */
export type DropletForFileInput = { dropletsRoot: string; file: string };

export function dropletForFile({ dropletsRoot, file }: DropletForFileInput): string | null {
  const rel = relative(dropletsRoot, file);
  if (!rel || rel.startsWith("..") || rel.includes(`..${sep}`)) return null;
  const folder = rel.split(sep)[0];
  return folder ? dropletId({ folderName: folder }) : null;
}

/**
 * Maps changed modules to the droplets affected by them. A file inside a
 * droplet folder is unambiguous; anything else (a shared component, a util)
 * is traced upwards through the module graph until droplet entries are
 * found, so editing a shared file refreshes every droplet using it.
 */
export type AffectedDropletsInput = {
  dropletsRoot: string;
  file: string;
  modules: Iterable<EnvironmentModuleNode>;
  extensions?: readonly string[];
};

export function affectedDroplets({ dropletsRoot, file, modules, extensions }: AffectedDropletsInput): Set<string> {
  const found = new Set<string>();

  const direct = dropletForFile({ dropletsRoot, file });
  if (direct) {
    found.add(direct);
    return found;
  }

  const queue: EnvironmentModuleNode[] = [...modules];
  const visited = new Set<EnvironmentModuleNode>();
  while (queue.length) {
    const mod = queue.pop();
    if (!mod || visited.has(mod)) continue;
    visited.add(mod);

    if (mod.id) {
      const droplet = extractDropletIdFromModuleId({ id: mod.id, extensions });
      if (droplet) found.add(droplet);
    }
    for (const importer of mod.importers) {
      if (!visited.has(importer)) queue.push(importer);
    }
  }

  return found;
}

/** `/src/droplets/hello/+droplet.server.ts` -> `{ droplet: "hello", server: true }`: a droplet's load file. */
export type ExtractLoadFromModuleIdInput = { id: string };

export function extractLoadFromModuleId({ id }: ExtractLoadFromModuleIdInput): { droplet: string; server: boolean } | null {
  const match = normalizePath({ value: id.split("?")[0] ?? "" }).match(/\/([^/]+)\/\+[Dd]roplet(\.server)?\.[cm]?[jt]s$/);
  const droplet = match?.[1] ? dropletId({ folderName: match[1] }) : null;
  return droplet === null ? null : { droplet, server: match?.[2] !== undefined };
}

/** What an edit touches in one droplet: its component side, its loads, and which. */
export type DropletChange = {
  /** The component, its error page, or a module they import (the browser's side). */
  component: boolean;
  /** `+droplet.server.ts`, `+droplet.ts`, or a module only they import. */
  load: boolean;
  /** `+droplet.ts` (or a module it imports): the browser runs that load too. */
  universal: boolean;
};

/**
 * Which droplets an edit to `file` reaches, and through what. A file in a
 * droplet folder is that droplet's: a load file or a server file
 * (`*.server.*`, under `server/`) is its load, anything else its component.
 * Any other file is traced up the module graphs given (the browser's and the
 * server's): reaching a component makes it a component edit of that droplet,
 * reaching `+droplet.ts` or `+droplet.server.ts` a load edit.
 */
export type ClassifyChangeInput = {
  dropletsRoot: string;
  file: string;
  modules: Iterable<EnvironmentModuleNode>;
  extensions?: readonly string[];
  isServerFile?: (file: string) => boolean;
};

export function classifyChange({
  dropletsRoot,
  file,
  modules,
  extensions,
  isServerFile = () => false,
}: ClassifyChangeInput): Map<string, DropletChange> {
  const changes = new Map<string, DropletChange>();
  const at = (droplet: string): DropletChange => {
    let change = changes.get(droplet);
    if (!change) changes.set(droplet, (change = { component: false, load: false, universal: false }));
    return change;
  };

  const direct = dropletForFile({ dropletsRoot, file });
  if (direct) {
    const load = extractLoadFromModuleId({ id: file });
    const change = at(direct);
    if (load) {
      change.load = true;
      change.universal = !load.server;
    } else if (isServerFile(file)) {
      change.load = true;
    } else {
      change.component = true;
    }
    return changes;
  }

  const queue: EnvironmentModuleNode[] = [...modules];
  const visited = new Set<EnvironmentModuleNode>();
  while (queue.length) {
    const mod = queue.pop();
    if (!mod || visited.has(mod)) continue;
    visited.add(mod);
    if (mod.id) {
      const component = extractDropletIdFromModuleId({ id: mod.id, extensions });
      if (component) at(component).component = true;
      const load = extractLoadFromModuleId({ id: mod.id });
      if (load) {
        const change = at(load.droplet);
        change.load = true;
        if (!load.server) change.universal = true;
      }
    }
    for (const importer of mod.importers) {
      if (!visited.has(importer)) queue.push(importer);
    }
  }
  return changes;
}

/**
 * Forces the generated registry to be rebuilt in every environment. Needed
 * when a droplet folder appears or disappears, since the registry is derived
 * from the filesystem rather than from any import.
 */
type InvalidateRegistryInput = { server: ViteDevServer };

export function invalidateRegistry({ server }: InvalidateRegistryInput): void {
  for (const env of Object.values(server.environments)) {
    const mod = env.moduleGraph.getModuleById(RESOLVED_VIRTUAL_DROPLETS);
    if (mod) env.moduleGraph.invalidateModule(mod);
  }
}

export type DevRuntime = {
  loadSsrModule: () => Promise<SsrModule>;
  refreshDropletMap: () => Promise<void>;
  /** Folder name per droplet id; folders may be cased differently. */
  folderById: () => Map<string, string>;
};

export type DevRuntimeOptions = { server: ViteDevServer; state: PluginState };

export function createDevRuntime({ server, state }: DevRuntimeOptions): DevRuntime {
  let folderById = new Map<string, string>();

  const ssrEnvironment = (): DevEnvironment | undefined => server.environments["ssr"];

  // Evaluated as at a server's start, outside the request that asked first:
  // a module's top level never keeps that request's location.
  const loadSsrModule = (): Promise<SsrModule> =>
    withoutRequestInfo(async () => {
      const env = ssrEnvironment();
      if (env && isRunnableDevEnvironment(env)) {
        return (await env.runner.import(entryServerPath)) as SsrModule;
      }
      return (await server.ssrLoadModule(toViteFsPath({ filePath: entryServerPath }))) as SsrModule;
    });

  const refreshDropletMap = async () => {
    let entries: DropletEntry[];
    try {
      entries = await discoverDroplets({ dropletsRoot: state.dropletsRoot, renderers: state.renderers });
    } catch (error) {
      // A folder in a bad state (two components, an unknown extension):
      // keep serving what was there and say what is wrong.
      logger.error("framework", error instanceof Error ? error.message : String(error));
      return;
    }
    state.entries = entries;
    await syncTypes(state);
    folderById = new Map(entries.map((e) => [e.id, e.name]));
    logger.debug("framework", "droplet map", [...folderById.keys()]);
  };

  return {
    loadSsrModule,
    refreshDropletMap,
    folderById: () => folderById,
  };
}

/**
 * The Hono app for `vite dev`: Vite transforms modules on demand, the SSR
 * module is re-evaluated per request so edits show up without a restart.
 */
export type DevAppOptions = { server: ViteDevServer; state: PluginState; runtime: DevRuntime };

export function createDevApp({ server, state, runtime }: DevAppOptions): DropletsApp {
  const { config } = state;

  const renderDroplet: RenderDroplet = async (name, event, options) => {
    const mod = await runtime.loadSsrModule();
    const render = mod.renderDroplet ?? mod.default;
    return render ? render(name, event, options) : null;
  };

  const getDropletMeta: GetDropletMeta = async (name) => {
    const mod = await runtime.loadSsrModule();
    return (await mod.getDropletMeta?.(name)) ?? { exists: true, ssr: true };
  };

  const loadDropletData: LoadDropletData = async (name, event) => {
    const mod = await runtime.loadSsrModule();
    return mod.loadDropletData ? mod.loadDropletData(name, event) : { data: undefined };
  };

  const clientEnvironment = () => {
    const env = server.environments["client"];
    if (!env) throw new Error("droplets: Vite has no client environment");
    return env;
  };

  const loadClientModule: LoadClientModule = async (name) => {
    if (!runtime.folderById().has(name)) await runtime.refreshDropletMap();
    const folder = runtime.folderById().get(name) ?? name;
    const result = await clientEnvironment().transformRequest(clientEntryId({ folderName: folder }));
    return result?.code ?? null;
  };

  // The entry itself, after the location record and the public runtime
  // variables: a module served whole, so they are set before its body runs.
  const loadEntryClient = async () => {
    const result = await clientEnvironment().transformRequest(toViteFsPath({ filePath: state.entryClientPath }));
    if (!result?.code) return null;
    const key = serverKey(config.element, state.buildHash);
    const env = (await runtime.loadSsrModule()).publicEnv?.() ?? {};
    return `${locationScript(key)}${Object.keys(env).length > 0 ? publicEnvScript(key, env) : ""}${result.code}`;
  };

  // Hand the browser an @import so Vite serves and watches the real file.
  const loadGlobalStyle = () => {
    const path = state.css.path;
    if (!path) return null;
    const href = path.startsWith("/") ? path : `/${path.replace(/^\.\//, "")}`;
    return `@import ${JSON.stringify(href)};\n`;
  };

  /**
   * Styles reach the browser through JavaScript in dev: Vite injects the
   * shared stylesheet with the entry and component styles with the droplet's
   * client module. So a droplet has no stylesheets of its own here:
   * `style.css` answers 404, and fragments neither link nor preload one. A
   * droplet with `hydrate = false` therefore renders without its component
   * styles in dev, styled in a production build.
   */
  const dropletStyles = (): string[] => [];

  // Printed once each, so an unchanged map does not repeat them.
  const warned = new Set<string>();

  // What each render ran with, for `withDevContext`.
  const devContexts = new WeakMap<Request, DevContext>();

  const app = createDropletsApp({
    devLog: createDevLog(),
    element: config.element,
    health: config.health,
    importMap: config.importMap,
    // Vite serves bare imports as `/@id/<name>` in dev; map both spellings.
    getImportMap: async () =>
      devImportMap({
        handler: (await runtime.loadSsrModule()).getImportMap?.(),
        transform: ({ map, externals }) => {
          if (config.warnImportMap) {
            for (const warning of checkImportMap({ map, externals, root: state.root })) {
              if (warned.has(warning)) continue;
              warned.add(warning);
              logger.warn("framework", `importmap: ${warning} (warnImportMap: false hides this)`);
            }
          }
          return { ...map, imports: withViteIdAliases({ importMap: map.imports }) ?? {} };
        },
      }),
    externals: () => externalsList(state),
    // Re-read per request, so editing hooks.server.ts or a +server.ts shows
    // up on the next request.
    getHandle: async () => (await runtime.loadSsrModule()).getHandle?.(),
    matchApi: async (pathname) => (await runtime.loadSsrModule()).matchApi?.(pathname) ?? null,
    renderError: async (name, error, props) => (await runtime.loadSsrModule()).renderError?.(name, error, props) ?? null,
    getHandleError: async () => devHandleError({ handleError: (await runtime.loadSsrModule()).getHandleError?.() }),
    validateProps: async (name, props) => {
      const mod = await runtime.loadSsrModule();
      return mod.validateDropletProps ? mod.validateDropletProps(name, props) : props;
    },
    transformDroplet: async (name, event) => {
      devContexts.set(event.request, { host: String(event.host), props: event.props });
      const mod = await runtime.loadSsrModule();
      return mod.transformDroplet ? mod.transformDroplet(name, event) : event.html;
    },
    findAction: async (name, action) => {
      const mod = await runtime.loadSsrModule();
      return mod.findAction ? mod.findAction(name, action) : "none";
    },
    // Nothing is prerendered in dev: props `entries` lists render live, the
    // others behave as in a build (404 when the droplet has `ssr = false`).
    loadPrerendered: async (name, key, event) => {
      const mod = await runtime.loadSsrModule();
      const keys = (await mod.prerenderKeys?.(name)) ?? [];
      if (!keys.includes(key)) return null;
      const result = await (mod.renderDroplet ?? mod.default)?.(name, event);
      if (!result) return null;
      if (!result.failed) return { html: result.html ?? result.body ?? "", data: result.serverData };
      const page = await mod.renderError?.(name, result.error, event.props);
      return {
        html: page ? `${page.head ?? ""}${page.html ?? page.body ?? ""}` : "",
        failed: true,
        error: result.error,
      };
    },
    // The devtools answer `/` before this app when they are installed.
    loadIndex: () => loadIndexHtml({ root: state.root, index: config.index }),
    renderDroplet,
    loadDropletData,
    getDropletMeta,
    loadClientModule,
    loadEntryClient,
    publicEnv: async () => (await runtime.loadSsrModule()).publicEnv?.() ?? {},
    loadGlobalStyle,
    dropletStyles,
    // `/index.js` is the entry itself, and modules come one by one: nothing
    // worth announcing ahead.
    linkHeader: false,
    buildHash: state.buildHash,
    tokenNonce: state.tokenNonce,
    // `vite dev` computes `location` and `host` per request, set or not.
    tokens: replacers,
    cors: config.cors,
    trustedOrigins: config.trustedOrigins,
    fragmentCacheControl: config.fragmentCacheControl,
    csrf: config.csrf,
    limits: config.limits,
  });
  if (state.publicDir) app.get(`/${PUBLIC_PATH}/*`, publicFileHandler({ publicDir: state.publicDir }));
  // `request()` goes through `fetch` too.
  const appFetch = app.fetch;
  app.fetch = async (request, ...rest) => {
    const response = await appFetch(request, ...rest);
    const context = devContexts.get(request);
    return context ? withDevContext({ response, context }) : response;
  };
  return app;
}

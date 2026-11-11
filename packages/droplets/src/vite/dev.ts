import { relative, sep } from "node:path";
import { isRunnableDevEnvironment } from "vite";
import type { DevEnvironment, EnvironmentModuleNode, ViteDevServer } from "vite";
import { discoverDroplets, dropletId } from "../core/discover.ts";
import { logger } from "../core/logger.ts";
import { entryServerPath, toViteFsPath } from "../core/paths.ts";
import { CORE_SUFFIXES } from "../renderer.ts";
import {
  createDropletsApp,
  isActionDataError,
  type GetDropletMeta,
  type LoadClientModule,
  type LoadDropletData,
  type RenderDroplet,
} from "../runtime/app.ts";
import type { HandleServerError, ImportMap, ImportMapHandler } from "../runtime/server.ts";
import type { SsrModule } from "../server/app.ts";
import { withViteIdAliases } from "./externalize.ts";
import { checkImportMap } from "./importmap-check.ts";
import { readIndexHtml } from "./index-html.ts";
import { externalsList, fallbackPrerenderHost, type PluginState } from "./state.ts";
import { syncTypes } from "./sync-types.ts";
import { clientEntryId, RESOLVED_VIRTUAL_DROPLETS } from "./virtual.ts";

/**
 * `handleError` under `vite dev`: a form action's data that cannot travel
 * as JSON is the developer's bug, so the answer names it, not only the log.
 * Kept out of the runtime app, which production servers bundle.
 */
export function devHandleError(handleError: HandleServerError | undefined): HandleServerError {
  return (input) => (isActionDataError(input.error) ? { message: input.error.message } : handleError?.(input));
}

/** `importmap` under `vite dev`, its map passed through `transform`; anything else is left for the app to refuse. */
export function devImportMap(
  handler: ImportMapHandler | undefined,
  transform: (map: ImportMap, externals: string[]) => ImportMap,
): ImportMapHandler | undefined {
  if (!handler) return undefined;
  return async (event) => {
    const externals = [...event.externals];
    const map: unknown = await handler(event);
    return typeof map === "object" && map !== null && !Array.isArray(map) ? transform(map as ImportMap, externals) : (map as ImportMap);
  };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * `/src/droplets/HelloWorld/+droplet.svelte` -> `hello-world`. With
 * `extensions`, only component suffixes a renderer handles match; without,
 * any suffix that is not a load file's (`+droplet.ts`, `+droplet.server.ts`).
 */
export function extractDropletIdFromModuleId(id: string, extensions?: string[]): string | null {
  const match = normalizePath(id.split("?")[0] ?? "").match(
    /\/([^/]+)\/\+[Dd]roplet(\.[^/]+)$/,
  );
  if (!match?.[1] || !match[2]) return null;
  const suffix = match[2];
  if (CORE_SUFFIXES.has(suffix)) return null;
  if (extensions && !extensions.includes(suffix)) return null;
  return dropletId(match[1]);
}

/** The droplet folder a file belongs to, if it is inside the droplets root. */
export function dropletForFile(
  dropletsRoot: string,
  file: string,
): string | null {
  const rel = relative(dropletsRoot, file);
  if (!rel || rel.startsWith("..") || rel.includes(`..${sep}`)) return null;
  const folder = rel.split(sep)[0];
  return folder ? dropletId(folder) : null;
}

/**
 * Maps changed modules to the droplets affected by them. A file inside a
 * droplet folder is unambiguous; anything else (a shared component, a util)
 * is traced upwards through the module graph until droplet entries are
 * found, so editing a shared file refreshes every droplet using it.
 */
export function affectedDroplets(
  dropletsRoot: string,
  file: string,
  modules: Iterable<EnvironmentModuleNode>,
  extensions?: string[],
): Set<string> {
  const found = new Set<string>();

  const direct = dropletForFile(dropletsRoot, file);
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
      const droplet = extractDropletIdFromModuleId(mod.id, extensions);
      if (droplet) found.add(droplet);
    }
    for (const importer of mod.importers) {
      if (!visited.has(importer)) queue.push(importer);
    }
  }

  return found;
}

/** `/src/droplets/Hello/+droplet.server.ts` -> `{ droplet: "hello", server: true }`: a droplet's load file. */
export function extractLoadFromModuleId(id: string): { droplet: string; server: boolean } | null {
  const match = normalizePath(id.split("?")[0] ?? "").match(/\/([^/]+)\/\+[Dd]roplet(\.server)?\.[cm]?[jt]s$/);
  if (!match?.[1]) return null;
  return { droplet: dropletId(match[1]), server: match[2] !== undefined };
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
export function classifyChange(
  dropletsRoot: string,
  file: string,
  modules: Iterable<EnvironmentModuleNode>,
  extensions?: string[],
  isServerFile: (file: string) => boolean = () => false,
): Map<string, DropletChange> {
  const changes = new Map<string, DropletChange>();
  const at = (droplet: string): DropletChange => {
    let change = changes.get(droplet);
    if (!change) changes.set(droplet, (change = { component: false, load: false, universal: false }));
    return change;
  };

  const direct = dropletForFile(dropletsRoot, file);
  if (direct) {
    const load = extractLoadFromModuleId(file);
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
      const component = extractDropletIdFromModuleId(mod.id, extensions);
      if (component) at(component).component = true;
      const load = extractLoadFromModuleId(mod.id);
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
export function invalidateRegistry(server: ViteDevServer): void {
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

export function createDevRuntime(
  server: ViteDevServer,
  state: PluginState,
): DevRuntime {
  let folderById = new Map<string, string>();

  const ssrEnvironment = (): DevEnvironment | undefined =>
    server.environments["ssr"];

  const loadSsrModule = async (): Promise<SsrModule> => {
    const env = ssrEnvironment();
    if (env && isRunnableDevEnvironment(env)) {
      return (await env.runner.import(entryServerPath)) as SsrModule;
    }
    return (await server.ssrLoadModule(toViteFsPath(entryServerPath))) as SsrModule;
  };

  const refreshDropletMap = async () => {
    let entries;
    try {
      entries = await discoverDroplets(state.dropletsRoot, state.renderers, { dev: true });
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
export function createDevApp(
  server: ViteDevServer,
  state: PluginState,
  runtime: DevRuntime,
) {
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
    const result = await clientEnvironment().transformRequest(clientEntryId(folder));
    return result?.code ?? null;
  };

  const loadEntryClient = async () => {
    const result = await clientEnvironment().transformRequest(
      toViteFsPath(state.entryClientPath),
    );
    return result?.code ?? null;
  };

  // Hand the browser an @import so Vite serves and watches the real file.
  const loadGlobalStyle = () => {
    const path = state.css.path;
    if (!path) return "";
    const href = path.startsWith("/") ? path : `/${path.replace(/^\.\//, "")}`;
    return `@import ${JSON.stringify(href)};\n`;
  };

  /**
   * Styles reach the browser through JavaScript in dev: Vite injects the
   * shared stylesheet with the entry and component styles with the droplet's
   * client module. So a droplet has no stylesheets of its own here:
   * `style.css` is empty, and fragments neither link nor preload one. A
   * droplet with `hydrate = false` therefore renders without its component
   * styles in dev, styled in a production build.
   */
  const dropletStyles = (): string[] => [];

  /** Warnings already printed, so an unchanged map does not repeat them. */
  const warned = new Set<string>();

  return createDropletsApp({
    element: config.element,
    health: config.health,
    importMap: config.importMap,
    // Vite serves bare imports as `/@id/<name>` in dev; map both spellings.
    getImportMap: async () =>
      devImportMap((await runtime.loadSsrModule()).getImportMap?.(), (map, externals) => {
        if (config.warnImportMap) {
          for (const warning of checkImportMap(map, externals, state.root)) {
            if (warned.has(warning)) continue;
            warned.add(warning);
            logger.warn("framework", `importmap: ${warning} (warnImportMap: false hides this)`);
          }
        }
        return { ...map, imports: withViteIdAliases(map.imports) ?? {} };
      }),
    externals: () => externalsList(state),
    // Re-read per request, so editing hooks.server.ts or a +server.ts shows
    // up on the next request.
    getHandle: async () => (await runtime.loadSsrModule()).getHandle?.(),
    matchApi: async (pathname) => (await runtime.loadSsrModule()).matchApi?.(pathname) ?? null,
    renderError: async (name, error) =>
      (await runtime.loadSsrModule()).renderError?.(name, error) ?? null,
    getHandleError: async () => devHandleError((await runtime.loadSsrModule()).getHandleError?.()),
    validateProps: async (name, props) => {
      const mod = await runtime.loadSsrModule();
      return mod.validateDropletProps ? mod.validateDropletProps(name, props) : props;
    },
    transformDroplet: async (name, event) => {
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
      const keys = (await mod.prerenderKeys?.(name, fallbackPrerenderHost(state))) ?? [];
      if (!keys.includes(key)) return null;
      const result = await (mod.renderDroplet ?? mod.default)?.(name, event);
      if (!result) return null;
      if (!result.failed) return { html: result.html ?? result.body ?? "", data: result.serverData };
      const page = await mod.renderError?.(name, result.error);
      return {
        html: page ? `${page.head ?? ""}${page.html ?? page.body ?? ""}` : "",
        failed: true,
        error: result.error,
      };
    },
    // The devtools answer `/` before this app when they are installed.
    loadIndex: () => readIndexHtml(state.root, config.index),
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
    cors: config.cors,
    trustedOrigins: config.trustedOrigins,
    fragmentCacheControl: config.fragmentCacheControl,
    csrf: config.csrf,
    limits: config.limits,
  });
}

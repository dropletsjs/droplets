import { dirname, resolve } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { isCSSRequest, searchForWorkspaceRoot, type EnvironmentModuleNode, type Plugin, type PluginOption, type UserConfig, type ViteDevServer } from "vite";
import { discoverDroplets } from "../core/discover.ts";
import { syncTypes } from "./types.ts";
import { loadEnvState, missingStatic } from "../core/env.ts";
import { setRuntimeEnv } from "../runtime/env-store.ts";
import { loadDropletsConfig } from "../core/load-config.ts";
import { logger } from "../core/logger.ts";
import { packageRoot } from "../core/paths.ts";
import type { DropletsAdapter } from "../adapters.ts";
import type { DevStrategy } from "../core/config.ts";
import {
  rendererScopeFilter,
  sharingRenderers,
  validateRenderers,
  type DropletRenderer,
  type HydrateMode,
} from "../renderer.ts";
import {
  buildOrder,
  createBuildEnvironments,
  requireAdapter,
  SERVER_NO_EXTERNAL,
  writeManifest,
} from "./build.ts";
import {
  classifyChange,
  createDevApp,
  createDevRuntime,
  dropletForFile,
  invalidateRegistry,
  type DevRuntime,
  type DropletChange,
} from "./dev.ts";
import { frameworksPlugin } from "./frameworks.ts";
import { userRenderers, withScriptRenderer } from "../script/index.ts";
import { isServerOnlyFile, serverOnlyPlugin } from "./server-only.ts";
import type { DropletEntry } from "../core/discover.ts";
import type { RenderContract } from "../runtime/dev-contract.ts";
import type { DropletPagePayload, DropletUpdatePayload } from "../runtime/entry-client.ts";
import { createCssConfig, resolveCss, tailwindPlugins, type DropletsCssOptions } from "./css.ts";
import { externalizePlugin } from "./externalize.ts";
import { createExternalMatcher, namedExternals, readClientExternal } from "./client-external.ts";
import { rm } from "node:fs/promises";
import { prerender } from "./prerender.ts";
import {
  applyConfig,
  createInitialState,
  CLIENT_HOOKS_FILES,
  HOOKS_FILES,
  rendererExtensions,
  type PluginState,
} from "./state.ts";
import { clientEntryId, virtualModulesPlugin } from "./virtual.ts";

export type DropletsPluginOptions = {
  /**
   * Path to the droplets config, relative to the Vite root. By default
   * `droplets.config.{ts,mts,js,mjs}` is looked up in the root.
   */
  configFile?: string;
  /**
   * What `vite build` emits as the server: `node()` from
   * `@dropletsjs/adapter-node`, `cloudflare()` from
   * `@dropletsjs/adapter-cloudflare`, or your own. Required for `vite build`
   * and `vite preview`; `vite dev` works without one.
   */
  adapter?: DropletsAdapter;
  /**
   * The UI engines that render droplets: `svelte()` from
   * `@dropletsjs/renderer-svelte`, `vue()` from
   * `@dropletsjs/renderer-vue`, or your own (see `DropletRenderer`).
   * Each claims file extensions: a `+droplet.svelte` goes to the Svelte
   * renderer, a `+droplet.vue` to Vue. Without any, every droplet folder is
   * an error that names the renderer to install, but for script droplets
   * (`+droplet.script.ts`, plain browser code), which are built in.
   */
  renderers?: DropletRenderer[];
  /** Stylesheets: the shared one, scoping, Tailwind. See `DropletsCssOptions`. */
  css?: DropletsCssOptions;
  prerender?: {
    /**
     * Where the renders `entries` lists happen, when an entry gives no
     * `host`: an absolute URL, `host` in their loads. `PUBLIC_URL` from the
     * environment does the same when this is not set. Without either, a
     * render is host-agnostic: `host.origin`, `host.pathname` and
     * `host.href` are tokens replaced per request, any other field of
     * `host` stops the build.
     */
    host?: string | URL;
  };
};

/** One droplet as the devtools see it. */
export type DropletSummary = {
  id: string;
  /** Folder name under the droplets folder. */
  folder: string;
  /** The component's file name, e.g. `+droplet.svelte`. */
  file: string;
  /** The renderer that handles it. */
  renderer: string;
  ssr: boolean;
  hydrate: HydrateMode;
  /** Has `+droplet.ts`. */
  hasLoad: boolean;
  /** Has `+droplet.server.ts`. */
  hasServerLoad: boolean;
  /** Has its own error page (`+error.<ext>`). */
  hasError: boolean;
  /** The error page's file name, when it has one. */
  errorFile?: string;
  /** Rendered at build for `entries`. */
  prerender: boolean;
};

/** Sent as `droplets:registry` whenever the list or a droplet's flags change. */
export type DropletRegistryPayload = { droplets: DropletSummary[] };

/**
 * What the core plugin exposes to companion plugins such as
 * `@dropletsjs/devtools`, as `plugin.api`. Dev only.
 */
export type DropletsPluginApi = {
  /** The custom element name from the config. */
  element(): string;
  /** `dev.strategy` from the config: what a page does about an edit, unless it says otherwise. */
  strategy(): DevStrategy;
  droplets(): DropletSummary[];
  /** The configured renderers' names: `["svelte", "react"]`; never the built-in `script`. */
  renderers(): string[];
  /** The droplets folder, absolute: `<root>/src/droplets` by default. */
  dropletsRoot(): string;
  /** Where the import map is served, or `false`. It may still 404: see `importMap`. */
  importMapPath(): string | false;
  /**
   * Answers a request with the droplets dev app, in process: fragments,
   * the import map, styles. What a host page's server would fetch over HTTP.
   */
  fetch(request: Request): Promise<Response>;
  /** The loader every page includes. */
  loaderUrl: string;
  /** Writes `.droplets/` (`./$types` for every droplet) for the droplets found now: what `djs sync` runs. */
  syncTypes(): Promise<void>;
  /**
   * The dev tool's browser module, as a URL the dev server serves: what
   * `index.js` imports for `dev.injectTool` or `?injectTool=true`. Set by
   * `dropletsDevtools()` in `configResolved`.
   */
  setDevTool(url: string): void;
};

function summarize(state: PluginState): DropletSummary[] {
  return state.entries.map((entry) => ({
    id: entry.id,
    folder: entry.name,
    file: entry.file,
    renderer: entry.renderer,
    ssr: entry.ssr,
    hydrate: entry.hydrate,
    hasLoad: entry.hasLoad,
    hasServerLoad: entry.hasServerLoad,
    hasError: entry.hasError,
    ...(entry.errorFile ? { errorFile: entry.errorFile } : {}),
    prerender: entry.prerender,
  }));
}

/** The folders the renderers' modules live in, for the dev server's `fs.allow`. */
function rendererDirs(renderers: DropletRenderer[]): string[] {
  const dirs = new Set<string>();
  for (const renderer of renderers) {
    for (const file of [renderer.server, renderer.client, renderer.clientSetup]) {
      if (file) dirs.add(dirname(file));
    }
  }
  return [...dirs];
}

/** The stylesheets among the modules and their importers: what can update without a reload. */
function stylesheetsOf(modules: EnvironmentModuleNode[]): EnvironmentModuleNode[] {
  const found = new Set<EnvironmentModuleNode>();
  for (const mod of modules) {
    for (const candidate of [mod, ...mod.importers]) {
      if (candidate.id && isCSSRequest(candidate.id) && !/[?&](inline|raw|url)\b/.test(candidate.id)) found.add(candidate);
    }
  }
  return [...found];
}

/** What one edit touched, for the hooks of every environment. */
type UpdatePlan = {
  changes: Map<string, DropletChange>;
  /** A droplet's component changed, its contract did not: the framework's HMR takes it. */
  component: boolean;
  /** A droplet's `ssr`, `hydrate` or `prerender` changed: no module update reaches the page. */
  contract: boolean;
};

function contractOf(entry: Pick<DropletEntry, "ssr" | "hydrate" | "prerender">): RenderContract {
  return { ssr: entry.ssr, hydrate: entry.hydrate, prerender: entry.prerender };
}

function isInside(root: string, file: string): boolean {
  return file === root || file.startsWith(`${root}/`) || file.startsWith(`${root}\\`);
}

/**
 * The Droplets Vite plugin.
 *
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite";
 * import { droplets } from "@dropletsjs/droplets/vite";
 *
 * export default defineConfig({ plugins: [droplets()] });
 * ```
 *
 * `vite dev` serves droplets with HMR, `vite build` emits the client bundles,
 * the SSR renderer and `dist/server.js`, and `vite preview` runs that build.
 */
export function droplets(options: DropletsPluginOptions = {}): PluginOption[] {
  const state = createInitialState();
  state.adapter = options.adapter ?? null;
  // Script droplets (`+droplet.script.ts`) are core's: their renderer is
  // always there, after the user's.
  state.renderers = withScriptRenderer(options.renderers ?? []);
  if (options.prerender?.host !== undefined) {
    const host = options.prerender.host;
    try {
      state.prerenderHost = new URL(host).href;
    } catch {
      throw new Error(`droplets: prerender.host must be an absolute URL such as "https://shop.example", got "${String(host)}"`);
    }
  }
  // Two renderers claiming one extension without packages to tell them apart
  // is a configuration error: say so when the config is read, not when a
  // droplet happens to use it.
  validateRenderers(state.renderers);
  let runtime: DevRuntime | null = null;
  /** What each edit touched, per HMR timestamp: worked out once, in the first environment. */
  const plans = new Map<number, UpdatePlan>();

  /**
   * Which droplets `file` reaches, through their component or their loads,
   * with their render contract before and after; each hears of it once, as
   * `droplets:update`, before Vite sends its own update.
   */
  const planUpdate = async (server: ViteDevServer, file: string, timestamp: number): Promise<UpdatePlan> => {
    const plan: UpdatePlan = { changes: new Map(), component: false, contract: false };
    if (!runtime) return plan;
    const before = new Map(state.entries.map((entry) => [entry.id, contractOf(entry)]));
    if (dropletForFile(state.dropletsRoot, file)) {
      // Flags are read from source, so any edit may change the registry.
      await runtime.refreshDropletMap();
      const registry = JSON.stringify(summarize(state));
      if (registry !== lastRegistry) {
        lastRegistry = registry;
        invalidateRegistry(server);
        server.hot.send("droplets:registry", { droplets: summarize(state) });
      }
    }
    const modules = Object.values(server.environments).flatMap((environment) => [
      ...(environment.moduleGraph.getModulesByFile(file) ?? []),
    ]);
    plan.changes = classifyChange(
      state.dropletsRoot,
      file,
      modules,
      rendererExtensions(state),
      (path) => isServerOnlyFile(state.root, path),
    );

    for (const [droplet, change] of plan.changes) {
      const entry = state.entries.find((e) => e.id === droplet);
      const after = entry ? contractOf(entry) : undefined;
      const old = before.get(droplet);
      const contract = old && after && JSON.stringify(old) !== JSON.stringify(after) ? { before: old, after } : null;
      if (contract) plan.contract = true;
      else if (change.component) plan.component = true;

      let hydrate: HydrateMode | undefined;
      try {
        const mod = await runtime.loadSsrModule();
        hydrate = (await mod.getDropletMeta?.(droplet))?.hydrate;
      } catch (error) {
        logger.debug("framework", "could not read droplet meta", {
          droplet,
          error,
        });
      }
      const payload: DropletUpdatePayload = {
        droplet,
        timestamp,
        kind: contract ? "contract" : change.component ? "component" : "load",
        ...(change.universal ? { universal: true } : {}),
        ...(contract ? contract : {}),
        ...(hydrate === undefined ? {} : { hydrate }),
        ...(entry ? { serverLoad: entry.hasServerLoad } : {}),
      };
      server.hot.send("droplets:update", payload);
    }
    return plan;
  };
  /** The registry the browser last heard about, to send only real changes. */
  let lastRegistry = "";

  /** The dev app, once the droplets are scanned; `null` outside `vite dev`. */
  let devApp: Promise<ReturnType<typeof createDevApp>> | null = null;

  const api: DropletsPluginApi = {
    element: () => state.config.element,
    strategy: () => state.config.dev.strategy,
    droplets: () => summarize(state),
    renderers: () => userRenderers(state.renderers).map((renderer) => renderer.name),
    dropletsRoot: () => state.dropletsRoot,
    importMapPath: () => (state.config.importMap ? state.config.importMap.path : false),
    fetch: async (request) => {
      if (!devApp) throw new Error("droplets: fetch is only available under vite dev");
      // A request may arrive before the first scan is done: wait for it.
      return (await devApp).fetch(request);
    },
    loaderUrl: "/index.js",
    syncTypes: () => syncTypes(state),
    setDevTool: (url) => {
      state.devToolUrl = url;
    },
  };

  const core: Plugin = {
    name: "droplets",
    sharedDuringBuild: true,
    api,

    async config(userConfig, env) {
      const root = resolve(userConfig.root ?? process.cwd());
      const loaded = await loadDropletsConfig(root, env, options.configFile);
      applyConfig(state, root, loaded.config);
      state.css = await resolveCss(options.css, root);
      state.configPath = loaded.path;
      state.env = await loadEnvState(
        root,
        env.mode,
        userConfig.envDir ? resolve(root, userConfig.envDir) : root,
      );
      state.configDependencies = [...loaded.dependencies, ...state.env.dependencies];
      const missing = missingStatic(state.env);
      if (missing.length) {
        const message = `static environment variables without a value: ${missing.join(", ")} (set them in .env or the environment)`;
        // A build would inline `undefined`; dev keeps running so it can be fixed live.
        if (env.command === "build") throw new Error(`droplets: ${message}`);
        logger.warn("framework", message);
      }
      state.outDir = resolve(root, userConfig.build?.outDir ?? "dist");
      state.entries = await discoverDroplets(state.dropletsRoot, state.renderers, { dev: env.command === "serve" });
      await syncTypes(state);

      const clientExternal = readClientExternal(userConfig);
      state.clientExternal = createExternalMatcher(clientExternal);
      // Pre-bundling would inline them in dev; keep them out, as the build does.
      const external = namedExternals(clientExternal);
      state.namedExternals = external;
      const css = createCssConfig(userConfig, state);
      const result: UserConfig = {
        appType: "custom",
        ...(css ? { css } : {}),
        server: {
          // The framework's runtime files and the renderers' modules live
          // outside the project root. Listing any directory turns off Vite's
          // default (the workspace root), so it has to be listed again or the
          // project's own files answer 403 when a stylesheet @imports them.
          fs: { allow: [searchForWorkspaceRoot(root), packageRoot, ...rendererDirs(state.renderers)] },
          ...(userConfig.server?.port === undefined
            ? { port: state.config.dev.server.port }
            : {}),
        },
        ...(external.length ? { optimizeDeps: { exclude: external } } : {}),
      };

      if (env.command === "build") {
        requireAdapter(state);
        if (state.entries.length === 0) {
          logger.warn("framework", "no droplets found", {
            folder: state.config.dropletsFolder,
          });
        }
        result.builder = {};
        result.environments = createBuildEnvironments(state);
      } else {
        result.environments = {
          ssr: { resolve: { noExternal: SERVER_NO_EXTERNAL } },
        };
      }

      return result;
    },

    configureServer(server) {
      runtime = createDevRuntime(server, state);
      const devRuntime = runtime;
      // Runtime private variables come from .env files in dev, like Vite's own.
      setRuntimeEnv(state.env.values);

      // A change to droplets.config.ts (or anything it imports) needs a
      // restart: the config shapes routes, ports and the registry.
      if (state.configDependencies.length) {
        server.watcher.add(state.configDependencies);
      }

      return () => {
        const app = (async () => {
          await devRuntime.refreshDropletMap();
          lastRegistry = JSON.stringify(summarize(state));
          return createDevApp(server, state, devRuntime);
        })();
        devApp = app;
        const ready = app.then((created) => getRequestListener(created.fetch));
        // After Vite's own middleware, so its asset and HMR routes win.
        // Registered now, not once the droplets are scanned: Vite does not
        // wait for this hook, and an early request must not fall through.
        server.middlewares.use((req, res, next) => {
          ready.then((listener) => listener(req, res), next);
        });
      };
    },

    async hotUpdate({ file, modules, server, timestamp, type }) {
      if (state.configDependencies.includes(file)) {
        logger.info("framework", "droplets config changed; restarting");
        void server.restart();
        return [];
      }
      if (!runtime) return;

      const structural = type !== "update";
      const isHooks = HOOKS_FILES.some(
        (hooks) => resolve(state.root, hooks) === file,
      );
      if (structural && (isHooks || isInside(state.apiRoot, file))) {
        // A route or the hooks file appeared or went away.
        invalidateRegistry(server);
      }

      // `init` ran once, before the droplets started: only a new page runs
      // it again. Whether this one reloads is `dev.strategy`'s call, in the
      // page: never the host's page behind its back under `hmr`.
      if (CLIENT_HOOKS_FILES.some((hooks) => resolve(state.root, hooks) === file)) {
        if (this.environment.name !== "client") return [];
        if (structural) invalidateRegistry(server);
        for (const mod of modules) this.environment.moduleGraph.invalidateModule(mod, new Set(), timestamp, true);
        const hooks: DropletPagePayload = { reason: "hooks.client", timestamp };
        server.hot.send("droplets:page", hooks);
        return [];
      }

      // Once per edit, in the client environment, which Vite runs first:
      // what changed, for which droplets, and what the pages hear of it.
      let plan = plans.get(timestamp);
      if (!plan) {
        plan = await planUpdate(server, file, timestamp);
        plans.set(timestamp, plan);
        for (const key of plans.keys()) {
          if (key < timestamp - 10_000) plans.delete(key);
        }
      }
      if (this.environment.name !== "client" || plan.changes.size === 0) return;

      // The modules invalidated as Vite would, and each affected droplet's
      // client module with them: the next import of its bundle (a remount, a
      // new load) asks for them again under a new `?t=`.
      const invalidated = new Set<EnvironmentModuleNode>();
      const graph = this.environment.moduleGraph;
      for (const droplet of plan.changes.keys()) {
        const folder = runtime.folderById().get(droplet);
        const client = folder ? graph.getModuleById(`\0${clientEntryId(folder)}`) : undefined;
        if (client) graph.invalidateModule(client, invalidated, timestamp, true);
      }
      // A new render contract never reaches the page's instance, and a load
      // edit reaches it as data: neither goes through the framework's HMR.
      // Stylesheets that depend on the file, Tailwind's among them, still
      // update the Vite way: they replace themselves, nothing reloads.
      if (plan.contract || !plan.component) {
        for (const mod of modules) graph.invalidateModule(mod, invalidated, timestamp, true);
        return stylesheetsOf(modules);
      }
      // A component edit: Vite's own HMR, so the framework's runs (Fast
      // Refresh, Prefresh, Vue, Svelte, Solid). Each droplet's client module
      // accepts its component as a last resort, so an edit no framework
      // module takes remounts the droplet in place rather than reloading the
      // page; a page under another strategy drops these updates and follows
      // `droplets:update`.
      return;
    },

    // What the client build left external, for `importmap`'s `externals`.
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return;
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const id of [...output.imports, ...output.dynamicImports]) {
          if (!id.startsWith(".") && !id.startsWith("/") && !(id in bundle)) {
            state.seenExternals.add(id);
          }
        }
      }
    },

    async buildApp(builder) {
      const adapter = requireAdapter(state);
      logger.info("framework", "build starting", {
        droplets: state.entries.map((e) => e.id),
        buildHash: state.buildHash,
        adapter: adapter.name,
      });
      let manifestPath: string | null = null;
      for (const name of buildOrder(state)) {
        const environment = builder.environments[name];
        if (!environment) {
          throw new Error(`droplets: missing build environment "${name}"`);
        }
        await builder.build(environment);
        // The manifest exists before the server builds, so an adapter's entry
        // can import it rather than read it at runtime.
        if (name === "client") manifestPath = await writeManifest(state);
        // Before the server: a Worker reads the renders through its assets.
        if (name === "ssr") {
          const renders = await prerender(state, resolve(state.outDir, "server/entry-server.js"));
          if (renders > 0) logger.info("framework", "prerendered", { renders });
          // Built only to prerender: an adapter that inlines the renderer
          // does not ship it.
          if (!adapter.separateSsrBundle) {
            await rm(resolve(state.outDir, "server"), { recursive: true, force: true });
          }
        }
      }
      if (!manifestPath) throw new Error("droplets: the client environment did not build");
      await adapter.afterBuild?.({
        root: state.root,
        outDir: state.outDir,
        manifestPath,
        serverPath: resolve(state.outDir, adapter.serverFile),
      });
      logger.info("framework", "build finished", { manifest: manifestPath });
    },

    configurePreviewServer(server) {
      const adapter = state.adapter;
      if (!adapter?.preview) {
        logger.warn(
          "framework",
          adapter
            ? `the ${adapter.name} adapter has no preview; use its own tooling to run the build`
            : "vite preview needs an adapter with preview support, e.g. node() from @dropletsjs/adapter-node",
        );
        return;
      }
      return async () => {
        const app = await adapter.preview!({
          root: state.root,
          outDir: state.outDir,
          config: state.config,
        });
        const listener = getRequestListener((request) => app.fetch(request));
        server.middlewares.use((req, res) => void listener(req, res));
      };
    },
  };

  const plugins: PluginOption[] = [
    virtualModulesPlugin(state),
    externalizePlugin(state),
    core,
  ];
  plugins.push(tailwindPlugins(state), serverOnlyPlugin(state), frameworksPlugin(state));
  // Each renderer compiles its own component files; when another renderer
  // shares an extension, only the modules marked for it.
  const shared = sharingRenderers(state.renderers);
  for (const renderer of state.renderers) {
    const scope = shared.has(renderer.name) ? { include: rendererScopeFilter(renderer.name) } : {};
    const own = typeof renderer.plugins === "function" ? renderer.plugins(scope) : renderer.plugins;
    if (own) plugins.push(own);
  }
  return plugins;
}

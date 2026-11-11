import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import type { ResolvedDevConfig, ResolvedDropletsConfig } from "../core/config.ts";
import { DEFAULTS, normalizeDropletsFolder } from "../core/config.ts";
import type { DropletEntry } from "../core/discover.ts";
import { entryClientPath } from "../core/paths.ts";
import type { DropletsAdapter } from "../adapters.ts";
import type { EnvState } from "../core/env.ts";
import type { DropletRenderer } from "../renderer.ts";
import type { ResolvedCss } from "./css.ts";

/**
 * Everything the individual plugins share. Filled in by the main plugin's
 * `config` hook, which runs before any other hook touches it.
 */
export type PluginState = {
  /** Short per-build token, appended to asset URLs as `?c=`. */
  buildHash: string;
  /** The user's project root. */
  root: string;
  /** Where `vite build` writes; `dist` unless the user changed `build.outDir`. */
  outDir: string;
  /** Absolute path of `droplets.config.ts`, or `null` when there is none. */
  configPath: string | null;
  /** Files `droplets.config.ts` imports; a change to any restarts the dev server. */
  configDependencies: string[];
  config: ResolvedDropletsConfig;
  /** `dev` of the config: what `vite dev` reads. */
  dev: ResolvedDevConfig;
  /** The plugin's `css` option, with defaults. */
  css: ResolvedCss;
  /**
   * Whether Tailwind runs, and whose plugin: the user's own `@tailwindcss/vite`,
   * or the one `css.tailwind` adds. Known once the config is resolved.
   */
  tailwind: { user: boolean; ours: boolean };
  /** Absolute path of the droplets folder. */
  dropletsRoot: string;
  /** Root-relative droplets folder, as Vite sees it: `/src/droplets`. */
  globRoot: string;
  /** Absolute path of the API folder. */
  apiRoot: string;
  /** Root-relative API folder, as Vite sees it: `/src/api`. */
  apiGlobRoot: string;
  /** Droplets found at config time; refreshed in dev as folders change. */
  entries: DropletEntry[];
  /** Where the entry client lives, for the virtual `/index.js` module. */
  entryClientPath: string;
  /** Decides the server bundle. Required for `vite build`; dev needs none. */
  adapter: DropletsAdapter | null;
  /** The UI engines, by the order given; each claims file extensions. */
  renderers: DropletRenderer[];
  /** `src/env.ts` and the values Vite loaded for the current mode. */
  env: EnvState;
  /**
   * The client build's externals, read from the user's Vite config, so dev
   * keeps the same imports out of droplet modules. `null` when there are none.
   */
  clientExternal: ((id: string, importer?: string) => boolean) | null;
  /**
   * Bare imports actually left external: seen in dev, or found in the client
   * bundle at build. Together with the named ones, the `externals` list.
   */
  seenExternals: Set<string>;
  /** Plain names from the external option, known before anything is built. */
  namedExternals: string[];
  /** The dev tool's browser module, as a URL Vite serves; set by `dropletsDevtools()`. */
  devToolUrl: string | null;
  /** `prerender.host` from `droplets()`: where an entry without `host` renders. */
  prerenderHost: string | undefined;
};

/**
 * Where an entry without `host` renders: `prerender.host`, else `PUBLIC_URL`
 * from the mode's environment, else nothing (host-agnostic renders).
 */
export function fallbackPrerenderHost(state: PluginState): string | undefined {
  if (state.prerenderHost) return state.prerenderHost;
  const publicUrl = state.env.values["PUBLIC_URL"];
  if (!publicUrl) return undefined;
  try {
    return new URL(publicUrl).href;
  } catch {
    throw new Error(`droplets: PUBLIC_URL must be an absolute URL such as "https://shop.example", got "${publicUrl}"`);
  }
}

export function createBuildHash(): string {
  return randomBytes(4).toString("hex").slice(0, 6);
}

/** A state object with placeholders, to be completed by the `config` hook. */
export function createInitialState(): PluginState {
  return {
    buildHash: createBuildHash(),
    root: process.cwd(),
    outDir: resolve(process.cwd(), "dist"),
    configPath: null,
    configDependencies: [],
    config: {
      dropletsFolder: "src/droplets",
      apiFolder: "src/api",
      health: "/health",
      importMap: { path: "/importmap", auto: true },
      warnImportMap: true,
      element: "djs-droplet",
      trustedOrigins: [],
      fragmentCacheControl: DEFAULTS.fragmentCacheControl,
      csrf: { checkOrigin: true },
      limits: { ...DEFAULTS.limits },
      server: { port: 8000 },
    },
    dev: { server: { port: 5173 }, strategy: "hmr", injectTool: false },
    css: { scoped: true, tailwind: false, twPreflight: true },
    tailwind: { user: false, ours: false },
    dropletsRoot: resolve(process.cwd(), "src/droplets"),
    globRoot: "/src/droplets",
    apiRoot: resolve(process.cwd(), "src/api"),
    apiGlobRoot: "/src/api",
    entries: [],
    entryClientPath,
    adapter: null,
    renderers: [],
    env: { path: null, declaration: {}, values: {}, dependencies: [] },
    clientExternal: null,
    seenExternals: new Set(),
    namedExternals: [],
    devToolUrl: null,
    prerenderHost: undefined,
  };
}

/** Every file suffix a configured renderer handles. */
export function rendererExtensions(state: PluginState): string[] {
  return state.renderers.flatMap((renderer) => renderer.extensions);
}

/** The renderer by name, or a clear error for a stale registry. */
export function rendererNamed(state: Pick<PluginState, "renderers">, name: string): DropletRenderer {
  const renderer = state.renderers.find((r) => r.name === name);
  if (!renderer) throw new Error(`droplets: no renderer named "${name}" is configured`);
  return renderer;
}

/** What `importmap` receives as `externals`: sorted, without duplicates. */
export function externalsList(state: PluginState): string[] {
  return [...new Set([...state.namedExternals, ...state.seenExternals])].sort();
}

/** Recomputes the folder-derived fields after the config has been resolved. */
export function applyConfig(
  state: PluginState,
  root: string,
  config: ResolvedDropletsConfig,
): void {
  const folder = normalizeDropletsFolder(config.dropletsFolder);
  state.root = root;
  state.config = { ...config, buildHash: state.buildHash };
  state.dropletsRoot = resolve(root, folder);
  state.globRoot = `/${folder}`;
  state.apiRoot = resolve(root, config.apiFolder);
  state.apiGlobRoot = `/${config.apiFolder}`;
}

/** `src/hooks.server.ts`, then `.js`; where `handle` lives. */
export const HOOKS_FILES = ["src/hooks.server.ts", "src/hooks.server.js"];
/**
 * `src/hooks.client.ts`, or another JavaScript or TypeScript extension;
 * where `init` lives, run by `/index.js` before any droplet starts.
 */
export const CLIENT_HOOKS_FILES = [
  "src/hooks.client.ts",
  "src/hooks.client.mts",
  "src/hooks.client.js",
  "src/hooks.client.mjs",
];
/** Where `importmap` lives, next to the hooks. */
export const IMPORTMAP_FILES = ["src/importmap.server.ts", "src/importmap.server.js"];

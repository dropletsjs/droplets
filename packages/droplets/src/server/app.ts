import type { Handler } from "hono";
import {
  createDropletsApp,
  type FindAction,
  type GetDropletMeta,
  type GetHandle,
  type LoadDropletData,
  type PrerenderedDroplet,
  type MatchApi,
  type RenderDroplet,
  type RenderError,
} from "../runtime/app.ts";
import type { HandleServerError, ImportMapHandler, TransformEvent } from "../runtime/server.ts";
import type { ResolvedDropletsConfig } from "../core/config.ts";
import { logger } from "../core/logger.ts";

/** What the built SSR bundle exports. */
export type SsrModule = {
  renderDroplet?: RenderDroplet;
  default?: RenderDroplet;
  getDropletMeta?: GetDropletMeta;
  loadDropletData?: LoadDropletData;
  getHandle?: GetHandle;
  matchApi?: MatchApi;
  renderError?: RenderError;
  getImportMap?: () => ImportMapHandler | undefined;
  getHandleError?: () => HandleServerError | undefined;
  validateDropletProps?: (name: string, props: Record<string, unknown>) => Promise<Record<string, unknown>>;
  transformDroplet?: (name: string, event: TransformEvent) => Promise<string>;
  getEntries?: (name: string) => Promise<Array<{ props: Record<string, unknown>; host?: string }>>;
  prerenderKeys?: (name: string, fallbackHost?: string) => Promise<string[]>;
  publicEnv?: () => Record<string, string | undefined>;
  findAction?: FindAction;
  /** The nonce of the location tokens the bundle writes (see `DropletsAppOptions.tokenNonce`). */
  tokenNonce?: string;
};

/**
 * How a runtime reads the client build: Node reads `dist/client` from disk,
 * a Worker reads it from its static assets. Every loader returns `null` for
 * something that does not exist.
 */
export type AssetLoaders = {
  /** The build hash from `droplets.json`, appended to asset URLs as `?c=`. */
  buildHash: string;
  loadClientModule(droplet: string): Promise<string | null>;
  /** The stub `/index.js` serves (`__entryClient`). */
  loadEntryClient(): Promise<string | null>;
  /** The module the stub imports (`__entryModule`), relative to `dist/client`. */
  entryModule(): Promise<string | null>;
  loadGlobalStyle(): Promise<string | null>;
  /** The droplet's stylesheets (`css`), relative to `dist/client`; `[]` when none. */
  dropletStyles(droplet: string): Promise<string[]>;
  /** The page for `/`, from the manifest; `null` answers 404. */
  loadIndex(): Promise<string | null>;
  /** The client build's external imports, from the manifest. */
  externals: string[];
  /**
   * The build-time render of a droplet with `prerender = true` for a
   * `propsKey`, from the server-only renders' directory (see
   * `PRERENDER_DIR`); `null` when there is none.
   */
  loadPrerendered?(droplet: string, key: string): Promise<PrerenderedDroplet | null>;
  /** Serves `/assets/*`: the entry, shared chunks, stylesheets, fonts. Cached for good. */
  assetHandler: Handler;
};

export type ServerAppOptions = {
  ssr: SsrModule;
  assets: AssetLoaders;
  config: ResolvedDropletsConfig;
};

let warnedCors = false;

/**
 * The production app, with nothing platform-specific in it: the SSR bundle
 * supplies rendering, hooks and API routes, the loaders supply assets.
 * Adapters wire it to a filesystem or a static-assets binding.
 */
export function createServerApp({ ssr, assets, config }: ServerAppOptions) {
  const renderDroplet = ssr.renderDroplet ?? ssr.default;
  if (!renderDroplet) {
    throw new Error("The SSR bundle does not export renderDroplet.");
  }
  if (config.cors?.origin === "*" && !warnedCors) {
    warnedCors = true;
    logger.warn(
      "framework",
      "cors allows every origin: Access-Control-Allow-Origin: * on every route (/api/*, _data, /index.js included); list the hosts' origins instead ({ origin: [...] }) for anything not public",
    );
  }

  const app = createDropletsApp({
    element: config.element,
    health: config.health,
    renderDroplet,
    ...(ssr.loadDropletData ? { loadDropletData: ssr.loadDropletData } : {}),
    ...(ssr.getDropletMeta ? { getDropletMeta: ssr.getDropletMeta } : {}),
    ...(ssr.getHandle ? { getHandle: ssr.getHandle } : {}),
    ...(ssr.matchApi ? { matchApi: ssr.matchApi } : {}),
    ...(ssr.renderError ? { renderError: ssr.renderError } : {}),
    ...(ssr.getImportMap ? { getImportMap: ssr.getImportMap } : {}),
    ...(ssr.getHandleError ? { getHandleError: ssr.getHandleError } : {}),
    ...(ssr.validateDropletProps ? { validateProps: ssr.validateDropletProps } : {}),
    ...(ssr.transformDroplet ? { transformDroplet: ssr.transformDroplet } : {}),
    ...(ssr.findAction ? { findAction: ssr.findAction } : {}),
    ...(assets.loadPrerendered
      ? { loadPrerendered: (name: string, key: string) => assets.loadPrerendered?.(name, key) ?? Promise.resolve(null) }
      : {}),
    importMap: config.importMap,
    externals: () => assets.externals,
    loadClientModule: (name) => assets.loadClientModule(name),
    loadEntryClient: () => assets.loadEntryClient(),
    ...(ssr.publicEnv ? { publicEnv: ssr.publicEnv } : {}),
    entryModule: () => assets.entryModule(),
    loadGlobalStyle: () => assets.loadGlobalStyle(),
    dropletStyles: (name) => assets.dropletStyles(name),
    loadIndex: () => assets.loadIndex(),
    buildHash: assets.buildHash,
    ...(ssr.tokenNonce === undefined ? {} : { tokenNonce: ssr.tokenNonce }),
    cors: config.cors,
    origin: config.origin,
    trustedOrigins: config.trustedOrigins,
    fragmentCacheControl: config.fragmentCacheControl,
    csrf: config.csrf,
    limits: config.limits,
  });

  app.get("/assets/*", assets.assetHandler);
  return app;
}

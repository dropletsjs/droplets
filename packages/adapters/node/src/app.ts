import {
  createServerApp,
  type ResolvedDropletsConfig,
  type SsrModule,
} from "@dropletsjs/droplets";
import { createAssetLoaders } from "./assets.ts";
import { createAssetHandler } from "./static.ts";

export type NodeServerPaths = {
  /** Directory holding `droplets.json`, the bundles and the assets. */
  clientRoot: string;
  /** File URL of the built SSR entry. */
  ssrEntryUrl: string;
  /**
   * Directory holding the server-only build output (`_prerendered/`), never
   * served. Default: `server` next to `clientRoot`.
   */
  serverRoot?: string;
};

/**
 * The production app on Node: the SSR bundle is imported from disk and the
 * client build is read from `dist/client`. Shared by `vite preview` and the
 * bundled `dist/server.js`.
 */
export async function createNodeServerApp(
  paths: NodeServerPaths,
  config: ResolvedDropletsConfig,
) {
  const ssr = (await import(paths.ssrEntryUrl)) as SsrModule;
  const loaders = createAssetLoaders(paths.clientRoot, paths.serverRoot);
  const manifest = await loaders.getManifest();

  return createServerApp({
    ssr,
    config,
    assets: {
      buildHash: manifest.__hash,
      loadClientModule: loaders.loadClientModule,
      loadEntryClient: loaders.loadEntryClient,
      entryModule: loaders.entryModule,
      loadGlobalStyle: loaders.loadGlobalStyle,
      dropletStyles: loaders.dropletStyles,
      loadIndex: loaders.loadIndex,
      loadPrerendered: loaders.loadPrerendered,
      externals: manifest.__externals ?? [],
      assetHandler: createAssetHandler(paths.clientRoot),
    },
  });
}

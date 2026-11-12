/**
 * The shape of `dist/client/droplets.json`, written by `vite build` and read
 * by every adapter.
 */

export type DropletManifestEntry = {
  /** Client bundle path, relative to `dist/client`; none for `hydrate = false`. */
  client?: string;
  /**
   * Every stylesheet the droplet needs, relative to `dist/client`: those of
   * the chunks it imports (a component shared with other droplets) first,
   * then its own. Absent when it has none.
   */
  css?: string[];
};

export type DropletsManifest = {
  __hash: string;
  /** The shared stylesheet, relative to `dist/client`, named by its content: first in every droplet's `css`. */
  __globalCss: string;
  /** What `/index.css` serves: a stub that imports `__globalCss`, never cached; the file exists only with a shared stylesheet. */
  __globalStyle: string;
  /** What `/index.js` serves: a stub that imports `__entryModule`, never cached. */
  __entryClient: string;
  /**
   * The element and the registry, under a name unique to the build, so it
   * can be cached for good. Absent when the build could not name it.
   */
  __entryModule?: string;
  /** The page `/` serves, as written; `null` when `index` is `false`. */
  __index: string | null;
  /** Bare imports the client build left external, for `importmap`. */
  __externals: string[];
  /**
   * The prerendered renders' directory in the client build, a name new
   * every build, for an adapter without `dist/server` (a Worker inlines the
   * manifest and keeps the file out of its assets). Absent otherwise: they
   * are in `dist/server/_prerendered/`.
   */
  __prerendered?: string;
  droplets: Record<string, DropletManifestEntry>;
};

/** What a runtime answers before the build is found; keeps routes alive. */
export const FALLBACK_MANIFEST: DropletsManifest = {
  __hash: "",
  __globalCss: "assets/droplets-css.css",
  __globalStyle: "index.css",
  __entryClient: "index.js",
  __index: null,
  __externals: [],
  droplets: {},
};

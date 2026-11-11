import { resolve } from "node:path";
import { createPrerenderedLoader, FALLBACK_MANIFEST, logger, PRERENDER_DIR, type DropletsManifest } from "@dropletsjs/droplets";
import { readJsonFile, readTextFile } from "./fs.ts";

/**
 * Reads built droplet assets off disk.
 *
 * The server serves these through its own routes rather than as plain static
 * files, so it controls cache headers per asset kind and answers 404 for
 * droplets that do not exist. Prerendered renders are server-only: read from
 * `serverRoot` (`dist/server`, by default next to `clientRoot`), which no
 * route serves.
 */
export function createAssetLoaders(clientRoot: string, serverRoot = resolve(clientRoot, "..", "server")) {
  const manifestPath = resolve(clientRoot, "droplets.json");
  const prerenderedRoot = resolve(serverRoot, PRERENDER_DIR);
  let cached: Promise<DropletsManifest> | null = null;

  const getManifest = (): Promise<DropletsManifest> => {
    cached ??= readJsonFile<DropletsManifest>(manifestPath).then((manifest) => {
      if (!manifest) {
        logger.warn("framework", "droplets.json not found; did you build?", {
          path: manifestPath,
        });
        return FALLBACK_MANIFEST;
      }
      return manifest;
    });
    return cached;
  };

  const readRelative = async (relativePath: string): Promise<string | null> => readTextFile(resolve(clientRoot, relativePath));

  /** A droplet's manifest entry; a name from a URL never reaches `Object.prototype`. */
  const dropletEntry = (manifest: DropletsManifest, droplet: string) =>
    Object.hasOwn(manifest.droplets, droplet) ? manifest.droplets[droplet] : undefined;

  return {
    getManifest,

    loadPrerendered: createPrerenderedLoader((relativePath) => readTextFile(resolve(prerenderedRoot, relativePath))),

    async loadClientModule(droplet: string): Promise<string | null> {
      const relativePath = dropletEntry(await getManifest(), droplet)?.client;
      return relativePath ? readRelative(relativePath) : null;
    },

    /** The stub, which imports `entryModule`. */
    async loadEntryClient(): Promise<string | null> {
      return readRelative((await getManifest()).__entryClient);
    },

    async entryModule(): Promise<string | null> {
      return (await getManifest()).__entryModule ?? null;
    },

    async loadGlobalStyle(): Promise<string | null> {
      return readRelative((await getManifest()).__globalCss);
    },

    async loadIndex(): Promise<string | null> {
      return (await getManifest()).__index ?? null;
    },

    /** Paths only: `style.css` imports them from `/assets/`. */
    async dropletStyles(droplet: string): Promise<string[]> {
      return dropletEntry(await getManifest(), droplet)?.css ?? [];
    },
  };
}

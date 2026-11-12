import { resolve } from "node:path";
import {
  createPrerenderedLoader,
  FALLBACK_MANIFEST,
  PRERENDER_DIR,
  type AssetLoaders,
  type DropletManifestEntry,
  type DropletsManifest,
} from "@dropletsjs/droplets";
import { loadJsonFile, loadTextFile, MalformedJsonError } from "./fs.ts";

export type AssetLoadersOptions = {
  clientRoot: string;
  /** Default: `server` next to `clientRoot`. */
  serverRoot?: string | undefined;
};

export type DiskAssetLoaders = Pick<
  AssetLoaders,
  "loadClientModule" | "loadEntryClient" | "entryModule" | "loadGlobalStyle" | "dropletStyles" | "loadIndex"
> &
  Required<Pick<AssetLoaders, "loadPrerendered">> & {
    loadManifest(): Promise<DropletsManifest>;
  };

type LoadRelativeInput = { relativePath: string };

type DropletEntryInput = { manifest: DropletsManifest; droplet: string };

type FallbackInput = { message: string };

/**
 * Reads built droplet assets off disk.
 *
 * The server serves these through its own routes rather than as plain static
 * files, so it controls cache headers per asset kind and answers 404 for
 * droplets that do not exist. Prerendered renders are server-only: read from
 * `serverRoot`, which no route serves.
 */
export function createAssetLoaders({
  clientRoot,
  serverRoot = resolve(clientRoot, "..", "server"),
}: AssetLoadersOptions): DiskAssetLoaders {
  const manifestPath = resolve(clientRoot, "droplets.json");
  const prerenderedRoot = resolve(serverRoot, PRERENDER_DIR);
  // Only a manifest that loaded is kept: a missing or malformed file is read
  // again on the next request, so a build that finishes later is seen.
  let cached: Promise<DropletsManifest> | null = null;
  // The failure last logged: once per failure, not per request, until a load succeeds.
  let logged: string | null = null;

  const fallback = ({ message }: FallbackInput): DropletsManifest => {
    if (logged !== message) {
      logged = message;
      console.error(message);
    }
    return FALLBACK_MANIFEST;
  };

  function loadManifest(): Promise<DropletsManifest> {
    cached ??= loadJsonFile<DropletsManifest>({ path: manifestPath }).then(
      (manifest) => {
        if (manifest) {
          logged = null;
          return manifest;
        }
        cached = null;
        return fallback({ message: `droplets.json not found at ${manifestPath}; did you build?` });
      },
      (error: unknown) => {
        cached = null;
        if (error instanceof MalformedJsonError) return fallback({ message: `${error.message}; did the build finish?` });
        throw error;
      },
    );
    return cached;
  }

  const loadRelative = ({ relativePath }: LoadRelativeInput): Promise<string | null> =>
    loadTextFile({ path: resolve(clientRoot, relativePath) });

  // A droplet name comes from the URL: it must never reach `Object.prototype`.
  const dropletEntry = ({ manifest, droplet }: DropletEntryInput): DropletManifestEntry | undefined =>
    Object.hasOwn(manifest.droplets, droplet) ? manifest.droplets[droplet] : undefined;

  return {
    loadManifest,

    loadPrerendered: createPrerenderedLoader((relativePath) => loadTextFile({ path: resolve(prerenderedRoot, relativePath) })),

    async loadClientModule(droplet: string): Promise<string | null> {
      const relativePath = dropletEntry({ manifest: await loadManifest(), droplet })?.client;
      return relativePath ? loadRelative({ relativePath }) : null;
    },

    async loadEntryClient(): Promise<string | null> {
      return loadRelative({ relativePath: (await loadManifest()).__entryClient });
    },

    async entryModule(): Promise<string | null> {
      return (await loadManifest()).__entryModule ?? null;
    },

    async loadGlobalStyle(): Promise<string | null> {
      return loadRelative({ relativePath: (await loadManifest()).__globalStyle });
    },

    async loadIndex(): Promise<string | null> {
      return (await loadManifest()).__index ?? null;
    },

    async dropletStyles(droplet: string): Promise<string[]> {
      return dropletEntry({ manifest: await loadManifest(), droplet })?.css ?? [];
    },
  };
}

import userConfig from "virtual:droplets-config";
import manifest from "virtual:droplets-manifest";
import * as ssr from "virtual:droplets-ssr";
import {
  type AssetLoaders,
  createPrerenderedLoader,
  createServerApp,
  type DropletManifestEntry,
  type DropletsApp,
  type ResolvedDropletsConfig,
  resolveConfig,
  setRuntimeEnv,
} from "@dropletsjs/droplets";

/** Injected by the adapter at build time (`rolldownOptions.output.intro`). */
declare const __DROPLETS_ASSETS_BINDING__: string;

/** The Workers Static Assets binding: `fetch` serves files from `dist/client`. */
type AssetsFetcher = {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
};

type Env = Record<string, unknown>;

// A function-form `droplets.config.ts` was called with the build's config
// env and may have returned a promise: resolved on the first request, since a
// Worker module has no top-level await.
let configPromise: Promise<ResolvedDropletsConfig> | null = null;

// One app per assets binding. Bindings are stable within an isolate, so this
// is a cache of one; a request without the binding still fails clearly.
const apps = new WeakMap<AssetsFetcher, Promise<DropletsApp>>();

type DropletEntryInput = { droplet: string };

type AssetLoadersOptions = { assets: AssetsFetcher; config: ResolvedDropletsConfig };

type LoadFileInput = { path: string };

type RevalidatedInput = { response: Response; ifNoneMatch: string | undefined; cacheControl: string | false };

type UncachedInput = { response: Response };

type AppOfInput = { env: Env };

// A droplet name comes from the URL: it must never reach `Object.prototype`.
function dropletEntry({ droplet }: DropletEntryInput): DropletManifestEntry | undefined {
  return Object.hasOwn(manifest.droplets, droplet) ? manifest.droplets[droplet] : undefined;
}

/** The client build's files, read through the assets binding. */
function createAssetLoaders({ assets, config }: AssetLoadersOptions): AssetLoaders {
  const loadFile = async ({ path }: LoadFileInput): Promise<string | null> => {
    // Only the pathname matters to the binding; the origin is a placeholder.
    const response = await assets.fetch(new URL(`/${path}`, "https://assets.invalid"));
    return response.ok ? response.text() : null;
  };

  return {
    buildHash: manifest.__hash,
    loadClientModule: (droplet) => {
      const entry = dropletEntry({ droplet });
      return entry?.client ? loadFile({ path: entry.client }) : Promise.resolve(null);
    },
    loadEntryClient: () => loadFile({ path: manifest.__entryClient }),
    entryModule: () => Promise.resolve(manifest.__entryModule ?? null),
    loadGlobalStyle: () => loadFile({ path: manifest.__globalStyle }),
    loadIndex: () => Promise.resolve(manifest.__index ?? null),
    // Read through the binding on demand: never part of the Worker bundle.
    // Their directory's name is new every build and only this bundle has
    // it, so no one can guess a URL for them, whatever the assets config.
    ...(manifest.__prerendered
      ? { loadPrerendered: createPrerenderedLoader((path) => loadFile({ path: `${manifest.__prerendered}/${path}` })) }
      : {}),
    externals: manifest.__externals ?? [],
    dropletStyles: (droplet) => Promise.resolve(dropletEntry({ droplet })?.css ?? []),
    // The entry, shared chunks and assets, from the binding, named by
    // their content and cached for good; `public/` under `/assets/public/`
    // keeps its names: `publicCacheControl`, with the binding's ETag and 304.
    assetHandler: async (c) => {
      const response = await assets.fetch(c.req.raw);
      // A missing file answers as it does on Node, never with the binding's own page.
      if (response.status === 404) return c.text("Not Found", 404, { "cache-control": "no-store" });
      if (response.status >= 400) return uncached({ response });
      if (!c.req.path.startsWith("/assets/public/")) {
        if (!response.ok) return response;
        const cached = new Response(response.body, response);
        cached.headers.set("cache-control", "public, max-age=2592000, immutable");
        cached.headers.set("x-content-type-options", "nosniff");
        return cached;
      }
      if (!response.ok && response.status !== 304) return response;
      return revalidated({ response, ifNoneMatch: c.req.header("if-none-match"), cacheControl: config.publicCacheControl });
    },
  };
}

/** A binding error, `no-store`: a file that is missing now may be deployed a moment later. */
function uncached({ response }: UncachedInput): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

/** `cacheControl` (none for `false`) with an `ETag`: the binding's, else one from the content, answered 304 when it matches. */
async function revalidated({ response, ifNoneMatch, cacheControl }: RevalidatedInput): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  if (cacheControl === false) headers.delete("cache-control");
  else headers.set("cache-control", cacheControl);
  if (response.status === 304 || headers.has("etag")) return new Response(response.body, { status: response.status, headers });
  const body = await response.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", body));
  const etag = `"${btoa(String.fromCharCode(...digest))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}"`;
  headers.set("etag", etag);
  if (ifNoneMatch?.split(",").some((tag) => tag.trim() === etag)) {
    headers.delete("content-length");
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: response.status, headers });
}

function loadConfig(): Promise<ResolvedDropletsConfig> {
  configPromise ??= Promise.resolve(userConfig).then((user) => resolveConfig(user ?? {}));
  return configPromise;
}

function appOf({ env }: AppOfInput): Promise<DropletsApp> {
  const assets = env[__DROPLETS_ASSETS_BINDING__] as AssetsFetcher | undefined;
  if (!assets) {
    throw new Error(
      `droplets: no "${__DROPLETS_ASSETS_BINDING__}" binding; add assets.directory and assets.binding to the wrangler config`,
    );
  }
  let app = apps.get(assets);
  if (!app) {
    app = loadConfig().then((config) => createServerApp({ ssr, config, assets: createAssetLoaders({ assets, config }) }));
    apps.set(assets, app);
  }
  return app;
}

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    // Runtime private variables are the Worker's vars and secrets.
    setRuntimeEnv(env);
    return (await appOf({ env })).fetch(request, env, ctx as never);
  },
};

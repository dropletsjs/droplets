import userConfig from "virtual:droplets-config";
import manifest from "virtual:droplets-manifest";
import * as ssr from "virtual:droplets-ssr";
import {
  createPrerenderedLoader,
  createServerApp,
  resolveConfig,
  setRuntimeEnv,
  type AssetLoaders,
} from "@dropletsjs/droplets";

/** Injected by the adapter at build time (`rolldownOptions.output.intro`). */
declare const __DROPLETS_ASSETS_BINDING__: string;

/** The Workers Static Assets binding: `fetch` serves files from `dist/client`. */
type AssetsFetcher = {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
};

type Env = Record<string, unknown>;

const config = resolveConfig(userConfig ?? {});

// One app per assets binding. Bindings are stable within an isolate, so this
// is a cache of one; a request without the binding still fails clearly.
const apps = new WeakMap<AssetsFetcher, ReturnType<typeof createServerApp>>();

/** A droplet's manifest entry; a name from a URL never reaches `Object.prototype`. */
function dropletEntry(droplet: string) {
  return Object.hasOwn(manifest.droplets, droplet) ? manifest.droplets[droplet] : undefined;
}

/** Reads a file of the client build through the assets binding. */
function createLoaders(assets: AssetsFetcher): AssetLoaders {
  const read = async (path: string): Promise<string | null> => {
    // Only the pathname matters to the binding; the origin is a placeholder.
    const response = await assets.fetch(new URL(`/${path}`, "https://assets.invalid"));
    return response.ok ? response.text() : null;
  };

  return {
    buildHash: manifest.__hash,
    loadClientModule: (droplet) => {
      const entry = dropletEntry(droplet);
      return entry?.client ? read(entry.client) : Promise.resolve(null);
    },
    loadEntryClient: () => read(manifest.__entryClient),
    entryModule: () => Promise.resolve(manifest.__entryModule ?? null),
    loadGlobalStyle: () => read(manifest.__globalCss),
    loadIndex: () => Promise.resolve(manifest.__index ?? null),
    // Read through the binding on demand: never part of the Worker bundle.
    // Their directory's name is new every build and only this bundle has
    // it, so no one can guess a URL for them, whatever the assets config.
    ...(manifest.__prerendered
      ? { loadPrerendered: createPrerenderedLoader((path) => read(`${manifest.__prerendered}/${path}`)) }
      : {}),
    externals: manifest.__externals ?? [],
    dropletStyles: (droplet) => Promise.resolve(dropletEntry(droplet)?.css ?? []),
    // The entry, shared chunks and assets, from the binding. Every name
    // under `/assets/` is unique to its build, so it is cached for good.
    assetHandler: async (c) => {
      const response = await assets.fetch(c.req.raw);
      if (!response.ok) return response;
      const cached = new Response(response.body, response);
      cached.headers.set("cache-control", "public, max-age=2592000, immutable");
      return cached;
    },
  };
}

function getApp(env: Env) {
  const assets = env[__DROPLETS_ASSETS_BINDING__] as AssetsFetcher | undefined;
  if (!assets) {
    throw new Error(
      `droplets: no "${__DROPLETS_ASSETS_BINDING__}" binding; add assets.directory and assets.binding to the wrangler config`,
    );
  }
  let app = apps.get(assets);
  if (!app) {
    app = createServerApp({ ssr, config, assets: createLoaders(assets) });
    apps.set(assets, app);
  }
  return app;
}

export default {
  fetch(request: Request, env: Env, ctx: unknown): Promise<Response> | Response {
    // Runtime private variables are the Worker's vars and secrets.
    setRuntimeEnv(env);
    return getApp(env).fetch(request, env, ctx as never);
  },
};

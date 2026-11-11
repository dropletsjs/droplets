import { createHash, randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadJsonFile, writeTextFile } from "../core/fs.ts";
import { logger } from "../core/logger.ts";
import { createDropletsApp } from "../runtime/app.ts";
import { createDevLog } from "../runtime/dev-log.ts";
import { setRuntimeEnv } from "../runtime/env-store.ts";
import type { SsrModule } from "../server/app.ts";
import type { DropletsManifest } from "../server/manifest.ts";
import { PRERENDER_DIR, prerenderIndexPath, type PrerenderIndex } from "../server/prerendered.ts";
import type { PluginState } from "./state.ts";

/** Read by `building` in `$droplets/env` when the SSR bundle loads. */
const BUILDING = Symbol.for("droplets.building");

/** What the fragment answers while building. */
type BuildRender = {
  key: string;
  html: string;
  renderId?: string;
  data?: unknown;
  failed?: true;
  error?: unknown;
  /** The nonce of the host tokens in a host-agnostic render. */
  nonce?: string;
  /** Set by the load's `setHeaders`. */
  headers?: Record<string, string>;
};

/** The origin of build-time requests: the droplets server, not the host. */
export const PRERENDER_ORIGIN = "http://droplets.build";

/** Set by the app on a render that read `host` without one. */
const PRERENDER_ERROR_HEADER = "x-droplets-prerender-error";

/** Where a render is stored, relative to the renders' directory: one file per prop set, named after its key. */
type PrerenderFileInput = { droplet: string; key: string };

export function prerenderFile({ droplet, key }: PrerenderFileInput): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `${droplet}/${hash}.json`;
}

/**
 * The renders' directory, never public as such (see `PRERENDER_DIR`):
 * `dist/server/_prerendered` for an adapter that ships `dist/server`, else
 * `_prerendered/<random>` in the client build, `assets`, a name new every
 * build that only the manifest holds, for a Worker to inline.
 */
export function prerenderRoot(state: PluginState): { dir: string; assets?: string } {
  if (state.adapter?.separateSsrBundle ?? true) return { dir: resolve(state.outDir, "server", PRERENDER_DIR) };
  const assets = `${PRERENDER_DIR}/${randomBytes(16).toString("hex")}`;
  return { dir: resolve(state.outDir, "client", assets), assets };
}

/**
 * Renders every droplet with `prerender = true` for each event its
 * `entries` lists, and stores HTML and server data in the renders'
 * directory (`prerenderRoot`). A load that fails is stored as its
 * `+error.*` render only when that page has `prerender = true`. Requests go through the built SSR bundle and
 * through `handle`, with `building` true. An entry renders for its `host`,
 * else `host` of the config, else host-agnostic; a render
 * that reads more of `host` than it can have stops the build. Returns how
 * many renders it wrote.
 */
type PrerenderInput = { state: PluginState; ssrEntry: string };

export async function prerender({ state, ssrEntry }: PrerenderInput): Promise<number> {
  const targets = state.entries.filter((entry) => entry.prerender);
  const clientRoot = resolve(state.outDir, "client");
  await rm(resolve(clientRoot, PRERENDER_DIR), { recursive: true, force: true });
  await rm(resolve(state.outDir, "server", PRERENDER_DIR), { recursive: true, force: true });
  if (targets.length === 0) return 0;
  const root = prerenderRoot(state);
  if (root.assets) {
    // The client is built and the server, which inlines the manifest, is
    // not yet: the name is written there and nowhere else.
    const manifestPath = resolve(clientRoot, "droplets.json");
    const manifest = await loadJsonFile<DropletsManifest>({ path: manifestPath });
    if (!manifest) throw new Error("droplets: cannot prerender before droplets.json is written");
    await writeTextFile({ path: manifestPath, contents: `${JSON.stringify({ ...manifest, __prerendered: root.assets }, null, 2)}\n` });
  }

  const global = globalThis as { [BUILDING]?: boolean };
  global[BUILDING] = true;
  // Private variables read at runtime come from the mode's `.env` here.
  setRuntimeEnv(state.env.values);
  try {
    // A fresh copy: `building` is read once, when the bundle is evaluated.
    const ssr = (await import(`${pathToFileURL(ssrEntry).href}?prerender=${Date.now()}`)) as SsrModule;
    const renderDroplet = ssr.renderDroplet ?? ssr.default;
    if (!renderDroplet || !ssr.getEntries) {
      throw new Error("droplets: the SSR bundle cannot prerender (no renderDroplet or getEntries)");
    }
    const app = createDropletsApp({
      devLog: createDevLog(),
      element: state.config.element,
      health: false,
      renderDroplet,
      ...(ssr.getDropletMeta ? { getDropletMeta: ssr.getDropletMeta } : {}),
      ...(ssr.getHandle ? { getHandle: ssr.getHandle } : {}),
      ...(ssr.getHandleError ? { getHandleError: ssr.getHandleError } : {}),
      ...(ssr.validateDropletProps ? { validateProps: ssr.validateDropletProps } : {}),
      ...(ssr.renderError ? { renderError: ssr.renderError } : {}),
      buildHash: state.buildHash,
      // The renders' tokens are the bundle's own: one nonce for both.
      ...(ssr.tokenNonce === undefined ? {} : { tokenNonce: ssr.tokenNonce }),
      building: true,
      location: state.config.location,
    });

    const fallbackHost = state.config.host;
    let count = 0;
    for (const entry of targets) {
      const index: PrerenderIndex = {};
      for (const event of await ssr.getEntries(entry.id)) {
        const host = event.host ?? fallbackHost;
        const props = event.props;
        const response = await app.request(`${PRERENDER_ORIGIN}/droplets/${entry.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ props, ...(host ? { host } : {}) }),
        });
        if (response.headers.get(PRERENDER_ERROR_HEADER)) {
          const { message } = (await response.json()) as { message: string };
          throw new Error(`droplets: ${message}`);
        }
        // `error()`, `redirect()` and failures without an error page: never
        // stored, those props render live.
        if (!response.ok) {
          const body = (await response.text()).slice(0, 200);
          logger.warn(
            "framework",
            `prerendering ${entry.id} with ${JSON.stringify(props)} answered ${response.status}; not stored, it renders live`,
            { body },
          );
          continue;
        }
        const render = (await response.json()) as BuildRender;
        // Two entries the schema turned into the same props: one render.
        if (index[render.key]) continue;
        // A load that failed is stored as the render of +error.*, the
        // droplet's error boundary: answered 500 per request, as live.
        const file = prerenderFile({ droplet: entry.id, key: render.key });
        const id = render.renderId ? { renderId: render.renderId } : {};
        // Kept with the render, never public: what its tokens look like.
        const nonce = render.nonce ? { nonce: render.nonce } : {};
        // And the headers its load set, served with it (a failed load's error page gets none).
        const headers = render.headers ? { headers: render.headers } : {};
        const stored = render.failed
          ? { html: render.html, ...id, ...nonce, failed: true, error: render.error }
          : { html: render.html, ...id, ...nonce, ...headers, data: render.data };
        await writeTextFile({ path: resolve(root.dir, file), contents: JSON.stringify(stored) });
        index[render.key] = file;
        count += 1;
      }
      await writeTextFile({ path: resolve(root.dir, prerenderIndexPath({ droplet: entry.id })), contents: JSON.stringify(index) });
      logger.debug("framework", "prerendered droplet", { droplet: entry.id, renders: Object.keys(index).length });
    }
    return count;
  } finally {
    delete global[BUILDING];
    setRuntimeEnv(undefined);
  }
}

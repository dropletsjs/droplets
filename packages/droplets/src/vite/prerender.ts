import { createHash, randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { connect, type PlainResponse, plainRequest, toResponse } from "../core/app-thread.ts";
import { loadJsonFile, writeTextFile } from "../core/fs.ts";
import { logger } from "../core/logger.ts";
import { packageDist } from "../core/paths.ts";
import { trustedOriginsWith } from "../runtime/security.ts";
import { withinTrusted } from "../runtime/web-url.ts";
import type { DropletsManifest } from "../server/manifest.ts";
import { PRERENDER_DIR, PRERENDERED_FILES_DIR, prerenderIndexPath, type PrerenderIndex } from "../server/prerendered.ts";
import type { PrerenderWorkerData } from "./prerender-worker.ts";
import type { PluginState } from "./state.ts";

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

type BuildEntry = { props: Record<string, unknown>; host?: string; file?: string };

type ShortInput = { text: string; max: number };

function short({ text, max }: ShortInput): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

type OriginListInput = { origins: readonly string[] };

function originList({ origins }: OriginListInput): string {
  const shown = origins.slice(0, 5).join(", ");
  return origins.length > 5 ? `${shown} and ${origins.length - 5} more` : shown;
}

type CheckEntryHostsInput = { state: PluginState; droplet: string; entries: readonly BuildEntry[] };

/**
 * Every entry's `host` within the bound a request's host passes at runtime
 * (`fixedHost`, `boundedHost` in `runtime/app.ts`): a render for a host the
 * server never gives this droplet would never be served. With `location`
 * set, its origin is this server's own; without it the build cannot know
 * the server's origin, so none counts as its own.
 */
function checkEntryHosts({ state, droplet, entries }: CheckEntryHostsInput): void {
  const { host: fixed, location, trustedOrigins } = state.config;
  const envOrigins = trustedOriginsWith({ configured: [], raw: process.env["DROPLETS_TRUSTED_ORIGINS"] });
  const trusted = trustedOriginsWith({ configured: trustedOrigins, raw: process.env["DROPLETS_TRUSTED_ORIGINS"] });
  const own = location === undefined ? [] : [new URL(location).origin];
  for (const entry of entries) {
    if (entry.host === undefined) continue;
    const host = new URL(entry.host);
    const where = `${droplet}: the entry ${short({ text: JSON.stringify(entry.props), max: 80 })} names host ${short({ text: entry.host, max: 120 })}`;
    if (fixed !== undefined) {
      if (host.origin === new URL(fixed).origin) continue;
      throw new Error(
        `droplets: ${where}, outside host in droplets.config.ts (${fixed}); drop the entry's host or change it to that origin`,
      );
    }
    if (withinTrusted({ host, trusted, own })) continue;
    const sources = [
      ...(trustedOrigins.length > 0 ? ["trustedOrigins in droplets.config.ts"] : []),
      ...(envOrigins.length > 0 ? ["DROPLETS_TRUSTED_ORIGINS"] : []),
    ].join(" and ");
    throw new Error(
      `droplets: ${where}, outside ${sources} (${originList({ origins: trusted })}); add the origin there or drop the entry's host`,
    );
  }
}

type IgnoredFilesInput = { state: PluginState; files: readonly string[] };

/** The one warning of a build whose entries name files it does not write, `null` when there is nothing to say. */
function ignoredFilesWarning({ state, files }: IgnoredFilesInput): string | null {
  if (files.length === 0) return null;
  const missing = [state.config.location === undefined ? "location" : "", state.config.host === undefined ? "host" : ""].filter(Boolean);
  const listed = files.length > 5 ? `${files.slice(0, 5).join(", ")}, …` : files.join(", ");
  return `prerender entries name files (${listed}), but files are written only with both location and host set in droplets.config.ts (${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set); no file is written, and these renders are served by the server as before`;
}

/** What became of one entry's render: its key once stored (or met again), and what the build kept of it. */
type EntryRender = { event: BuildEntry; key?: string; failed?: boolean; headers?: Record<string, string> };

/** What `prerender` wrote: the stored renders, and the files entries asked for. */
export type PrerenderResult = { renders: number; files: number };

/**
 * Renders every droplet with `prerender = true` for each event its
 * `entries` lists, and stores HTML and server data in the renders'
 * directory (`prerenderRoot`). A load that fails is stored as its
 * `+error.*` render, answered 500 per request; `error()`, `redirect()` and
 * a failure without an error page are not stored and render live. Requests
 * go through the built SSR bundle and
 * through `handle`, with `building` true. An entry renders for its `host`,
 * else `host` of the config, else host-agnostic; an entry's `host` outside
 * the runtime's bound stops the build first (`checkEntryHosts`); a render
 * that reads more of `host` than it can have stops the build.
 *
 * With `location` and `host` both set, an entry's `file` also writes its
 * render as `dist/client/assets/prerendered/<id>/<file>.html`: the body a
 * server over the stored renders answers for its props, a `200` only;
 * without both, `file` is checked, not written, and the build warns once.
 *
 * The bundle is evaluated in a worker thread (`prerender-worker.ts`): it
 * finds the globals a server has, not the build process's, and what it
 * installs stays with it.
 */
type PrerenderInput = { state: PluginState; ssrEntry: string };

export async function prerender({ state, ssrEntry }: PrerenderInput): Promise<PrerenderResult> {
  const targets = state.entries.filter((entry) => entry.prerender);
  const clientRoot = resolve(state.outDir, "client");
  await rm(resolve(clientRoot, PRERENDER_DIR), { recursive: true, force: true });
  await rm(resolve(state.outDir, "server", PRERENDER_DIR), { recursive: true, force: true });
  await rm(resolve(clientRoot, PRERENDERED_FILES_DIR), { recursive: true, force: true });
  if (targets.length === 0) return { renders: 0, files: 0 };
  const root = prerenderRoot(state);
  const manifestPath = resolve(clientRoot, "droplets.json");
  const manifest = await loadJsonFile<DropletsManifest>({ path: manifestPath });
  if (!manifest) throw new Error("droplets: cannot prerender before droplets.json is written");
  if (root.assets) {
    // The client is built and the server, which inlines the manifest, is
    // not yet: the name is written there and nowhere else.
    await writeTextFile({ path: manifestPath, contents: `${JSON.stringify({ ...manifest, __prerendered: root.assets }, null, 2)}\n` });
  }
  const isFixed = state.config.location !== undefined && state.config.host !== undefined;

  const workerData: PrerenderWorkerData = {
    ssrEntry,
    element: state.config.element,
    buildHash: state.buildHash,
    location: state.config.location,
    host: state.config.host,
    env: state.env.values,
    renders: root.dir,
    styles: Object.fromEntries(Object.entries(manifest.droplets ?? {}).map(([id, entry]) => [id, entry.css ?? []])),
    fragmentCacheControl: state.config.fragmentCacheControl,
  };
  const app = connect({ file: resolve(packageDist, "vite/prerender-worker.js"), workerData });
  try {
    let count = 0;
    let files = 0;
    const ignored: string[] = [];
    for (const entry of targets) {
      const index: PrerenderIndex = {};
      const events = await app.call<BuildEntry[]>("entries", entry.id);
      checkEntryHosts({ state, droplet: entry.id, entries: events });
      const outcomes: EntryRender[] = [];
      for (const event of events) {
        const host = event.host;
        const props = event.props;
        const outcome: EntryRender = { event };
        outcomes.push(outcome);
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
          const file = isFixed && event.file ? `, and ${PRERENDERED_FILES_DIR}/${entry.id}/${event.file}.html is not written` : "";
          logger.warn(
            "framework",
            `prerendering ${entry.id} with ${JSON.stringify(props)} answered ${response.status}; not stored, it renders live${file}`,
            { body },
          );
          continue;
        }
        const render = (await response.json()) as BuildRender;
        outcome.key = render.key;
        if (render.failed) outcome.failed = true;
        if (render.headers) outcome.headers = render.headers;
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
      // After the index: the server that answers for the files reads it once.
      for (const { event, key, failed, headers } of outcomes) {
        if (!event.file) continue;
        if (!isFixed) {
          ignored.push(`${entry.id}/${event.file}`);
          continue;
        }
        if (key === undefined) continue;
        const path = `${PRERENDERED_FILES_DIR}/${entry.id}/${event.file}.html`;
        const props = JSON.stringify(event.props);
        if (failed) {
          logger.warn("framework", `prerendering ${entry.id} with ${props} failed and stored its +error page; ${path} is not written`);
          continue;
        }
        const response = toResponse({
          plain: await app.call<PlainResponse>(
            "file",
            plainRequest({
              url: `${PRERENDER_ORIGIN}/droplets/${entry.id}`,
              init: {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ props: event.props, ...(event.host ? { host: event.host } : {}) }),
              },
            }),
          ),
        });
        if (response.status !== 200) {
          logger.warn(
            "framework",
            `prerendering ${entry.id} with ${props}: the fragment answered ${response.status}; ${path} is not written`,
            {
              body: (await response.text()).slice(0, 200),
            },
          );
          continue;
        }
        await writeTextFile({ path: resolve(clientRoot, path), contents: await response.text() });
        files += 1;
        if (headers) {
          logger.warn(
            "framework",
            `${entry.id}: the load set ${Object.keys(headers).join(", ")} with setHeaders; ${path} is served with fragmentCacheControl and _headers only, without them`,
          );
        }
      }
    }
    const warning = ignoredFilesWarning({ state, files: ignored });
    if (warning) logger.warn("framework", warning);
    return { renders: count, files };
  } finally {
    await app.stop();
  }
}

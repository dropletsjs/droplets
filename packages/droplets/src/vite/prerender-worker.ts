/**
 * The build's prerender pass, the part that evaluates the SSR bundle: in a
 * worker thread (`core/app-thread.ts`), so the bundle finds the globals a
 * server has, not the build process's, and leaves nothing behind in it.
 * `prerender.ts` drives it: `entries` for a droplet's events, `request`
 * for each render, `file` for each render an entry writes as a file.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { workerData } from "node:worker_threads";
import { answer, type PlainRequest, plainResponse } from "../core/app-thread.ts";
import { createDropletsApp, type DropletsApp } from "../runtime/app.ts";
import { createDevLog } from "../runtime/dev-log.ts";
import { setRuntimeEnv } from "../runtime/env-store.ts";
import type { SsrModule } from "../server/app.ts";
import { PRERENDER_FILE_RENDER_MISSING, SSR_BUNDLE_CANNOT_PRERENDER } from "../errors/build.ts";
import { dropletsError, type ErrorFormat } from "../errors/format.ts";
import { createPrerenderedLoader } from "../server/prerendered.ts";

/** Read by `building` in `$droplets/env` when the SSR bundle loads. */
const BUILDING = Symbol.for("droplets.building");

export type PrerenderWorkerData = {
  ssrEntry: string;
  element: string;
  buildHash: string;
  location: string | undefined;
  host: string | undefined;
  /** Private variables read at runtime come from the mode's `.env`. */
  env: Record<string, unknown>;
  /** The renders' directory (`prerenderRoot`), read back for the files. */
  renders: string;
  /** Each droplet's stylesheets, `css` of `droplets.json`. */
  styles: Record<string, string[]>;
  /** `fragmentCacheControl` of the config, as the server answers with it. */
  fragmentCacheControl: string | false;
  /** `render.rerunLoad` of the config: which data payload a render puts in its HTML. */
  rerunLoad: boolean;
  errorFormat: ErrorFormat;
};

const { ssrEntry, element, buildHash, location, host, env, renders, styles, fragmentCacheControl, rerunLoad, errorFormat } =
  workerData as PrerenderWorkerData;

(globalThis as { [BUILDING]?: boolean })[BUILDING] = true;
setRuntimeEnv(env);
const ssr = (await import(pathToFileURL(ssrEntry).href)) as SsrModule;
const renderDroplet = ssr.renderDroplet ?? ssr.default;
if (!renderDroplet || !ssr.getEntries) {
  throw dropletsError({ message: SSR_BUNDLE_CANNOT_PRERENDER });
}
const entries = ssr.getEntries;
const app = createDropletsApp({
  devLog: createDevLog(),
  errorFormat,
  element,
  health: false,
  renderDroplet,
  ...(ssr.getDropletMeta ? { getDropletMeta: ssr.getDropletMeta } : {}),
  ...(ssr.getHandle ? { getHandle: ssr.getHandle } : {}),
  ...(ssr.getHandleError ? { getHandleError: ssr.getHandleError } : {}),
  ...(ssr.validateDropletProps ? { validateProps: ssr.validateDropletProps } : {}),
  ...(ssr.renderError ? { renderError: ssr.renderError } : {}),
  buildHash,
  // The renders' tokens are the bundle's own: one nonce for both.
  ...(ssr.tokenNonce === undefined ? {} : { tokenNonce: ssr.tokenNonce }),
  ...(ssr.tokens === undefined ? {} : { tokens: ssr.tokens }),
  ...(ssr.encodePayload ? { encodePayload: ssr.encodePayload } : {}),
  building: true,
  render: { timeout: Number.POSITIVE_INFINITY, rerunLoad },
  location,
  // An entry without `host` renders for this one: the app knows it.
  host,
});

let serving: DropletsApp | undefined;

/**
 * A server over the renders just stored, as a production server answers
 * with them: a file holds what the fragment answers, by construction. It
 * never renders live, and nothing it reads waits on `render.timeout`.
 */
function servingApp(): DropletsApp {
  serving ??= createDropletsApp({
    devLog: createDevLog(),
    errorFormat,
    element,
    health: false,
    renderDroplet: (name) => Promise.reject(dropletsError({ message: PRERENDER_FILE_RENDER_MISSING, droplet: name })),
    ...(ssr.getDropletMeta ? { getDropletMeta: ssr.getDropletMeta } : {}),
    ...(ssr.getHandle ? { getHandle: ssr.getHandle } : {}),
    ...(ssr.getHandleError ? { getHandleError: ssr.getHandleError } : {}),
    ...(ssr.validateDropletProps ? { validateProps: ssr.validateDropletProps } : {}),
    ...(ssr.renderError ? { renderError: ssr.renderError } : {}),
    ...(ssr.transformDroplet ? { transformDroplet: ssr.transformDroplet } : {}),
    loadPrerendered: createPrerenderedLoader((path) => readFile(resolve(renders, path), "utf8").catch(() => null)),
    dropletStyles: (name) => (Object.hasOwn(styles, name) ? (styles[name] ?? []) : []),
    linkHeader: false,
    buildHash,
    ...(ssr.tokenNonce === undefined ? {} : { tokenNonce: ssr.tokenNonce }),
    ...(ssr.tokens === undefined ? {} : { tokens: ssr.tokens }),
    ...(ssr.encodePayload ? { encodePayload: ssr.encodePayload } : {}),
    location,
    host,
    fragmentCacheControl,
    render: { timeout: Number.POSITIVE_INFINITY, rerunLoad },
  });
  return serving;
}

answer({
  entries: (droplet: string) => entries(droplet),
  request: async ({ url, method, headers, body }: PlainRequest) =>
    plainResponse({ response: await app.request(url, { method, headers, body }) }),
  file: async ({ url, method, headers, body }: PlainRequest) =>
    plainResponse({ response: await servingApp().request(url, { method, headers, body }) }),
});

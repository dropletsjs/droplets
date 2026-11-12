/**
 * The build's prerender pass, the part that evaluates the SSR bundle: in a
 * worker thread (`core/app-thread.ts`), so the bundle finds the globals a
 * server has, not the build process's, and leaves nothing behind in it.
 * `prerender.ts` drives it: `entries` for a droplet's events, `request`
 * for each render.
 */
import { pathToFileURL } from "node:url";
import { workerData } from "node:worker_threads";
import { answer, type PlainRequest, plainResponse } from "../core/app-thread.ts";
import { createDropletsApp } from "../runtime/app.ts";
import { createDevLog } from "../runtime/dev-log.ts";
import { setRuntimeEnv } from "../runtime/env-store.ts";
import type { SsrModule } from "../server/app.ts";

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
};

const { ssrEntry, element, buildHash, location, host, env } = workerData as PrerenderWorkerData;

(globalThis as { [BUILDING]?: boolean })[BUILDING] = true;
setRuntimeEnv(env);
const ssr = (await import(pathToFileURL(ssrEntry).href)) as SsrModule;
const renderDroplet = ssr.renderDroplet ?? ssr.default;
if (!renderDroplet || !ssr.getEntries) {
  throw new Error("droplets: the SSR bundle cannot prerender (no renderDroplet or getEntries)");
}
const entries = ssr.getEntries;
const app = createDropletsApp({
  devLog: createDevLog(),
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
  building: true,
  location,
  // An entry without `host` renders for this one: the app knows it.
  host,
});

answer({
  entries: (droplet: string) => entries(droplet),
  request: async ({ url, method, headers, body }: PlainRequest) =>
    plainResponse({ response: await app.request(url, { method, headers, body }) }),
});

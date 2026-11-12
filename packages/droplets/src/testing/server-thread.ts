/**
 * The kit's droplets server runs in a worker thread (`conformance-server.ts`,
 * through `core/app-thread.ts`): its own module graph and its own globals,
 * as a server has, so a renderer's server build (a DOM shim, the custom
 * elements it defines) and its browser bundles in the kit's happy-dom never
 * meet. This is what the two sides share, and how the kit starts the thread
 * and sends it requests.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { connect, type PlainResponse, plainRequest, toResponse } from "../core/app-thread.ts";
import { packageDist } from "../core/paths.ts";

export type ServerWorkerData = { outDir: string; element: string };

/** Which app answers: the server, or one rendering as the build's prerender pass does. */
export type ServerApp = "server" | "building";

type ReadFromInput = { dir: string };

/** Reads a file of `dir` as text; `null` for one the build did not write. */
export function readFrom({ dir }: ReadFromInput): (path: string) => Promise<string | null> {
  return async (path) => {
    try {
      return await readFile(resolve(dir, path), "utf8");
    } catch {
      return null;
    }
  };
}

/** The server as the kit calls it, Hono's `request` and `fetch`, answered in the thread. */
export type Served = {
  request(input: string | Request, init?: RequestInit): Promise<Response>;
  fetch(request: Request): Promise<Response>;
};

export type ServerThread = { app: Served; building: Served; stop(): Promise<void> };

/** Starts the server thread; it shares the environment, so `vi.stubEnv` reaches it. */
export function startServer({ outDir, element }: ServerWorkerData): ServerThread {
  const thread = connect({ file: resolve(packageDist, "testing/conformance-server.js"), workerData: { outDir, element } });

  function served(app: ServerApp): Served {
    const fetch: Served["fetch"] = async (request) =>
      toResponse({
        plain: await thread.call<PlainResponse>("request", app, {
          url: request.url,
          method: request.method,
          headers: [...request.headers],
          body: request.method === "GET" || request.method === "HEAD" ? null : await request.text(),
        }),
      });
    return {
      fetch,
      request: async (input, init) =>
        typeof input === "string"
          ? toResponse({ plain: await thread.call<PlainResponse>("request", app, plainRequest({ url: input, init })) })
          : fetch(input),
    };
  }

  return { app: served("server"), building: served("building"), stop: thread.stop };
}

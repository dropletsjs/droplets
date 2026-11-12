/**
 * The conformance kit's droplets server, in a worker thread of its own (see
 * `server-thread.ts` and `core/app-thread.ts`): the fixture's SSR bundle
 * behind `createServerApp`, and a second app rendering as the build's
 * prerender pass does. `request` answers for either.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { workerData } from "node:worker_threads";
import { answer, type PlainRequest, plainResponse } from "../core/app-thread.ts";
import { resolveConfig } from "../core/config.ts";
import { createDropletsApp } from "../runtime/app.ts";
import { createServerApp, type SsrModule } from "../server/app.ts";
import type { DropletsManifest } from "../server/manifest.ts";
import { createPrerenderedLoader, PRERENDER_DIR } from "../server/prerendered.ts";
import { readFrom, type ServerApp, type ServerWorkerData } from "./server-thread.ts";

const { outDir, element } = workerData as ServerWorkerData;

const read = readFrom({ dir: resolve(outDir, "client") });
const readRendered = readFrom({ dir: resolve(outDir, "server", PRERENDER_DIR) });
const manifest = JSON.parse((await read("droplets.json")) ?? "null") as DropletsManifest | null;
if (!manifest) throw new Error("dist/client/droplets.json: the build wrote no manifest");
const ssr = (await import(pathToFileURL(resolve(outDir, "server/entry-server.js")).href)) as SsrModule;
const server = createServerApp({
  ssr,
  config: resolveConfig({ element }),
  assets: {
    buildHash: manifest.__hash,
    loadClientModule: async (id) => {
      const file = manifest.droplets[id]?.client;
      return file ? read(file) : null;
    },
    loadEntryClient: () => read(manifest.__entryClient),
    entryModule: async () => manifest.__entryModule ?? null,
    loadGlobalStyle: () => read(manifest.__globalStyle),
    dropletStyles: async (id) => manifest.droplets[id]?.css ?? [],
    loadIndex: async () => manifest.__index,
    externals: manifest.__externals,
    assetHandler: async (c) => {
      const body = await read(c.req.path.slice(1));
      return body === null ? c.text("Not Found", 404) : c.body(body);
    },
    loadPrerendered: createPrerenderedLoader(readRendered),
  },
});
const renderDroplet = ssr.renderDroplet ?? ssr.default;
if (!renderDroplet) throw new Error("the SSR bundle exports no renderDroplet");
const building = createDropletsApp({
  element,
  health: false,
  renderDroplet,
  ...(ssr.getDropletMeta ? { getDropletMeta: ssr.getDropletMeta } : {}),
  ...(ssr.validateDropletProps ? { validateProps: ssr.validateDropletProps } : {}),
  ...(ssr.renderError ? { renderError: ssr.renderError } : {}),
  ...(ssr.tokens ? { tokens: ssr.tokens } : {}),
  building: true,
});

answer({
  request: async (app: ServerApp, { url, method, headers, body }: PlainRequest) =>
    plainResponse({ response: await (app === "building" ? building : server).request(url, { method, headers, body }) }),
});

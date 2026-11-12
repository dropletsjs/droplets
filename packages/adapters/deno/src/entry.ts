import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import userConfig from "virtual:droplets-config";
import { type DropletsApp, resolveConfig } from "@dropletsjs/droplets";
import { createNodeServerApp } from "@dropletsjs/adapter-node";

// Bundled as `dist/server.js`, next to `client/` and `server/`: paths are
// relative to this file, not to the working directory. `deno serve` owns the
// port, so `server.port` and `PORT` do not apply.
const runtimeRoot = dirname(fileURLToPath(import.meta.url));

const paths = {
  clientRoot: resolve(runtimeRoot, "client"),
  ssrEntryUrl: pathToFileURL(resolve(runtimeRoot, "server/entry-server.js")).href,
};

// A function-form `droplets.config.ts` was called with the build's config env; it may have returned a promise.
const config = resolveConfig((await userConfig) ?? {});

let appPromise: Promise<DropletsApp> | null = null;

function loadApp(): Promise<DropletsApp> {
  appPromise ??= createNodeServerApp(paths, config);
  return appPromise;
}

export default {
  fetch: async (request: Request): Promise<Response> => {
    const app = await loadApp();
    return app.fetch(request);
  },
};

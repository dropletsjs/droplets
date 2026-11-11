import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import userConfig from "virtual:droplets-config";
import { type DropletsApp, resolveConfig } from "@dropletsjs/droplets";
import { createNodeServerApp } from "@dropletsjs/adapter-node";

// Bundled as `dist/server.js`, next to `client/` and `server/`: paths are
// relative to this file, not to the working directory.
const runtimeRoot = dirname(fileURLToPath(import.meta.url));

const paths = {
  clientRoot: resolve(runtimeRoot, "client"),
  ssrEntryUrl: pathToFileURL(resolve(runtimeRoot, "server/entry-server.js")).href,
};

const config = resolveConfig(userConfig ?? {}, { port: process.env["PORT"] });

let appPromise: Promise<DropletsApp> | null = null;

function loadApp(): Promise<DropletsApp> {
  appPromise ??= createNodeServerApp(paths, config);
  return appPromise;
}

// `bun dist/server.js` serves the default export itself (and says where);
// importing the file does not.
export default {
  port: config.server.port,
  // Bun's development mode answers errors with its own debug page.
  development: false,
  fetch: async (request: Request): Promise<Response> => {
    const app = await loadApp();
    return app.fetch(request);
  },
};

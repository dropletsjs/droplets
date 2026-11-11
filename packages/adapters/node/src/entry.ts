import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import userConfig from "virtual:droplets-config";
import { type DropletsApp, logger, resolveConfig } from "@dropletsjs/droplets";
import { createNodeServerApp } from "./app.ts";

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

/** Listens on `server.port` of the config, which `PORT` overrides. */
export async function runServer(): Promise<void> {
  const app = await loadApp();
  const port = config.server.port;

  serve({ fetch: app.fetch, port }, () => {
    logger.info("framework", `server listening on http://localhost:${port}`);
  });
}

/** Fetch handler, for hosts that drive the server themselves. */
export default {
  fetch: async (request: Request): Promise<Response> => {
    const app = await loadApp();
    return app.fetch(request);
  },
};

// `node dist/server.js` starts listening; importing it does not.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runServer();
}

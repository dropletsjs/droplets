import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import userConfig from "virtual:droplets-config";
import { logger, resolveConfig } from "@dropletsjs/droplets";
import { createNodeServerApp } from "./app.ts";

/**
 * The bundled production server for Node. Vite emits this as
 * `dist/server.js`, next to the `client/` and `server/` output directories,
 * so paths are resolved relative to this file rather than to the working
 * directory. The user's `droplets.config.ts` is bundled in through
 * `virtual:droplets-config`.
 */
const runtimeRoot = dirname(fileURLToPath(import.meta.url));

const paths = {
  clientRoot: resolve(runtimeRoot, "client"),
  ssrEntryUrl: pathToFileURL(resolve(runtimeRoot, "server/entry-server.js"))
    .href,
};

const config = resolveConfig(userConfig ?? {}, { port: process.env["PORT"] });

let appPromise: ReturnType<typeof createNodeServerApp> | null = null;

function getApp() {
  appPromise ??= createNodeServerApp(paths, config);
  return appPromise;
}

/** Starts listening on `config.server.port` (or `PORT`). */
export async function runServer(): Promise<void> {
  const app = await getApp();
  const port = config.server.port;

  serve({ fetch: app.fetch, port }, () => {
    logger.info("framework", `server listening on http://localhost:${port}`);
  });
}

/** Fetch handler, for hosts that drive the server themselves. */
export default {
  fetch: async (request: Request): Promise<Response> => {
    const app = await getApp();
    return app.fetch(request);
  },
};

// `node dist/server.js` starts listening; importing it does not.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runServer();
}

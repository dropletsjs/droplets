import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import userConfig from "virtual:droplets-config";
import { resolveConfig } from "@dropletsjs/droplets";
import { createNodeServerApp } from "@dropletsjs/adapter-node";

/**
 * The bundled production server for Deno, emitted as `dist/server.js` next
 * to `client/` and `server/`; paths resolve from this file, not the working
 * directory. `deno serve` owns the port, so `server.port` and `PORT` do not
 * apply here.
 */
const runtimeRoot = dirname(fileURLToPath(import.meta.url));

const paths = {
  clientRoot: resolve(runtimeRoot, "client"),
  ssrEntryUrl: pathToFileURL(resolve(runtimeRoot, "server/entry-server.js")).href,
};

const config = resolveConfig(userConfig ?? {});

let appPromise: ReturnType<typeof createNodeServerApp> | null = null;

function getApp() {
  appPromise ??= createNodeServerApp(paths, config);
  return appPromise;
}

export default {
  fetch: async (request: Request): Promise<Response> => {
    const app = await getApp();
    return app.fetch(request);
  },
};

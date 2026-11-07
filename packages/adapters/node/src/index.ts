import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DropletsAdapter } from "@dropletsjs/droplets";
import { createNodeServerApp } from "./app.ts";

export { createNodeServerApp, type NodeServerPaths } from "./app.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The Node adapter: `vite build` emits `dist/server.js`, run with
 * `node dist/server.js` or imported for its `{ fetch }` export. The SSR
 * renderer is a separate bundle next to it, and the client build is read from
 * `dist/client` at runtime.
 *
 * ```ts
 * import { droplets } from "@dropletsjs/droplets/vite";
 * import { node } from "@dropletsjs/adapter-node";
 *
 * export default defineConfig({ plugins: [droplets({ adapter: node() })] });
 * ```
 */
export function node(): DropletsAdapter {
  return {
    name: "node",
    serverEntry: resolve(here, "entry.js"),
    serverFile: "server.js",
    separateSsrBundle: true,
    noExternal: ["@hono/node-server", /^@hono\/node-server\//, "@dropletsjs/adapter-node"],
    preview: ({ outDir, config }) =>
      createNodeServerApp(
        {
          clientRoot: resolve(outDir, "client"),
          ssrEntryUrl: pathToFileURL(resolve(outDir, "server/entry-server.js")).href,
        },
        config,
      ),
  };
}

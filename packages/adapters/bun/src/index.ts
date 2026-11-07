import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DropletsAdapter } from "@dropletsjs/droplets";
import { createNodeServerApp } from "@dropletsjs/adapter-node";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The Bun adapter: `vite build` emits `dist/server.js`, run with
 * `bun dist/server.js`. Its default export is `{ port, fetch }`, which Bun
 * serves when the file is the entry point; imported, it only hands over
 * `fetch`. The app is the Node adapter's, through Bun's `node:` modules: the
 * SSR renderer is a separate bundle next to it, and the client build is read
 * from `dist/client` at runtime.
 *
 * ```ts
 * import { droplets } from "@dropletsjs/droplets/vite";
 * import { bun } from "@dropletsjs/adapter-bun";
 *
 * export default defineConfig({ plugins: [droplets({ adapter: bun() })] });
 * ```
 */
export function bun(): DropletsAdapter {
  return {
    name: "bun",
    serverEntry: resolve(here, "entry.js"),
    serverFile: "server.js",
    separateSsrBundle: true,
    noExternal: ["@dropletsjs/adapter-node", "@dropletsjs/adapter-bun"],
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

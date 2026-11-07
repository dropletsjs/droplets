import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DropletsAdapter } from "@dropletsjs/droplets";
import { createNodeServerApp } from "@dropletsjs/adapter-node";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The Deno adapter: `vite build` emits `dist/server.js`, served with
 * `deno serve -A dist/server.js` (`--port`, 8000 by default; `--parallel`
 * for one worker per core). Its default export is `{ fetch }`, so a host can
 * import it as well. The app is the Node adapter's, through Deno's `node:`
 * modules: the SSR renderer is a separate bundle next to it, and the client
 * build is read from `dist/client` at runtime.
 *
 * ```ts
 * import { droplets } from "@dropletsjs/droplets/vite";
 * import { deno } from "@dropletsjs/adapter-deno";
 *
 * export default defineConfig({ plugins: [droplets({ adapter: deno() })] });
 * ```
 */
export function deno(): DropletsAdapter {
  return {
    name: "deno",
    serverEntry: resolve(here, "entry.js"),
    serverFile: "server.js",
    separateSsrBundle: true,
    noExternal: ["@dropletsjs/adapter-node", "@dropletsjs/adapter-deno"],
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

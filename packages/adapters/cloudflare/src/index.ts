import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger, type DropletsAdapter } from "@dropletsjs/droplets";
import { defaultServerConditions } from "vite";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * `dist/client/.assetsignore`: what wrangler never uploads. The manifest
 * (with the prerendered renders' directory name) is inlined into the Worker
 * and Vite's own manifest is a build input; neither is ever served.
 */
const ASSETS_IGNORE = "/droplets.json\n/.vite/\n";

export type CloudflareAdapterOptions = {
  /**
   * The binding name of Workers Static Assets, as declared in the wrangler
   * config (`assets.binding`). Default: `ASSETS`.
   */
  assetsBinding?: string;
};

/**
 * The Cloudflare Workers adapter: `vite build` emits `dist/worker.js`, a
 * self-contained Worker with the SSR renderer and the manifest inlined. The
 * client build in `dist/client` is served through Workers Static Assets.
 *
 * ```ts
 * import { droplets } from "@dropletsjs/droplets/vite";
 * import { cloudflare } from "@dropletsjs/adapter-cloudflare";
 *
 * export default defineConfig({ plugins: [droplets({ adapter: cloudflare() })] });
 * ```
 *
 * ```jsonc
 * // wrangler.jsonc
 * {
 *   "main": "dist/worker.js",
 *   "compatibility_date": "2025-10-01",
 *   "compatibility_flags": ["nodejs_compat"],   // Svelte's SSR uses AsyncLocalStorage
 *   "assets": { "directory": "dist/client", "binding": "ASSETS", "run_worker_first": true }
 * }
 * ```
 */
export function cloudflare(options: CloudflareAdapterOptions = {}): DropletsAdapter {
  const assetsBinding = options.assetsBinding ?? "ASSETS";
  return {
    name: "cloudflare",
    serverEntry: resolve(here, "worker.js"),
    serverFile: "worker.js",
    // The renderer is inlined through virtual:droplets-ssr.
    separateSsrBundle: false,
    // A Worker has no node_modules: everything goes into the bundle.
    noExternal: true,
    environment: {
      // Bundled dependencies (React's CJS entries, Vue, …) pick their build
      // from process.env.NODE_ENV; a server environment keeps it as a runtime
      // read, so both builds would ship. Vite has set it by the time the
      // config loads: "production" for `vite build` unless overridden.
      define: { "process.env.NODE_ENV": JSON.stringify(process.env["NODE_ENV"] || "production") },
      resolve: {
        conditions: ["workerd", "worker", ...defaultServerConditions.filter((c) => c !== "node")],
      },
      build: {
        target: "es2022",
        rolldownOptions: {
          output: {
            // The binding name is a build-time constant of the entry.
            intro: `const __DROPLETS_ASSETS_BINDING__ = ${JSON.stringify(assetsBinding)};`,
          },
        },
      },
    },
    async afterBuild({ root, outDir, serverPath }) {
      await writeFile(resolve(outDir, "client/.assetsignore"), ASSETS_IGNORE);
      const hasWranglerConfig = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"].some(
        (file) => existsSync(resolve(root, file)),
      );
      if (!hasWranglerConfig) {
        logger.info(
          "framework",
          `no wrangler config found; point "main" at ${serverPath} and "assets.directory" at dist/client`,
        );
      }
    },
  };
}

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
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

const WRANGLER_CONFIGS = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];

/** JSON with comments and trailing commas, as wrangler reads it, to plain JSON. */
function jsonc(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      const end = /"(?:[^"\\]|\\.)*"/y;
      end.lastIndex = i;
      const string = end.exec(text)?.[0] ?? char;
      out += string;
      i += string.length - 1;
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (char === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
    } else {
      out += char;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** A wrangler config: its file name and its text. */
type WranglerConfig = { file: string; text: string };

/** `assets.run_worker_first` of a wrangler config's text, `undefined` when it is not set; throws when the text does not parse. */
function runWorkerFirst({ file, text }: WranglerConfig): unknown {
  if (file.endsWith(".toml")) {
    const section = /^\[assets\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text)?.[1] ?? "";
    const value = /^\s*run_worker_first\s*=\s*(.+?)\s*(?:#.*)?$/m.exec(section)?.[1];
    return value === undefined ? undefined : JSON.parse(value.replace(/'/g, '"'));
  }
  const config = JSON.parse(jsonc(text)) as { assets?: { run_worker_first?: unknown } };
  return config.assets?.run_worker_first;
}

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
      const file = WRANGLER_CONFIGS.find((name) => existsSync(resolve(root, name)));
      if (!file) {
        logger.info(
          "framework",
          `no wrangler config found; point "main" at ${serverPath}, "assets.directory" at dist/client and set "assets.run_worker_first": true`,
        );
        return;
      }
      let value: unknown;
      try {
        value = runWorkerFirst({ file, text: await readFile(resolve(root, file), "utf8") });
      } catch {
        logger.warn("framework", `could not read assets.run_worker_first in ${file}; it must be true`);
        return;
      }
      if (value !== true) {
        // Static assets answered first would serve /index.js without the
        // location record and every file without CORS or its cache headers:
        // a page on another origin breaks, so the build stops.
        throw new Error(
          `droplets: ${file}: assets.run_worker_first is ${value === undefined ? "not set" : JSON.stringify(value)}; set "assets": { "run_worker_first": true }: /index.js, /droplets/* and /assets/* need the Worker's answer (CORS, cache headers, the location record)`,
        );
      }
    },
  };
}

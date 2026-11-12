import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DropletsAdapter, DropletsManifest } from "@dropletsjs/droplets";
import { logger } from "@dropletsjs/droplets/vite";
import { defaultServerConditions } from "vite";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * `dist/client/.assetsignore`: what wrangler never uploads. The manifest
 * (with the prerendered renders' directory name) is inlined into the Worker
 * and Vite's own manifest is a build input; neither is ever served.
 */
const ASSETS_IGNORE = "/droplets.json\n/.vite/\n";

const WRANGLER_CONFIGS = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];

/** The project's own `_headers`, in its root: appended after the adapter's rules, so it has the last word. */
const USER_HEADERS = "_headers";

type ToJsonInput = { text: string };

/** JSON with comments and trailing commas, as wrangler reads it, to plain JSON. */
function toJson({ text }: ToJsonInput): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
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

type ReadWranglerConfigInput = { file: string; text: string };

/** What the adapter reads of a wrangler config: each `undefined` when it is not set. */
type WranglerConfig = { runWorkerFirst: unknown; compatibilityFlags: unknown };

type TomlValueInput = { section: string; key: string };

/** The JSON value of `key = …` in a TOML section's text (`[`, `]`, strings, booleans), `undefined` when the line is absent. */
function tomlValue({ section, key }: TomlValueInput): unknown {
  const value = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*(?:#.*)?$`, "m").exec(section)?.[1];
  return value === undefined ? undefined : JSON.parse(value.replace(/'/g, '"'));
}

/** `assets.run_worker_first` and the top-level `compatibility_flags` of a wrangler config's text; throws when the text does not parse. */
function readWranglerConfig({ file, text }: ReadWranglerConfigInput): WranglerConfig {
  if (file.endsWith(".toml")) {
    const top = /^([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text)?.[1] ?? "";
    const assets = /^\[assets\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text)?.[1] ?? "";
    return {
      runWorkerFirst: tomlValue({ section: assets, key: "run_worker_first" }),
      compatibilityFlags: tomlValue({ section: top, key: "compatibility_flags" }),
    };
  }
  const config = JSON.parse(toJson({ text })) as { assets?: { run_worker_first?: unknown }; compatibility_flags?: unknown };
  return { runWorkerFirst: config.assets?.run_worker_first, compatibilityFlags: config.compatibility_flags };
}

type HasNodeCompatInput = { flags: unknown };

/** Whether `compatibility_flags` turns Node compatibility on (`nodejs_compat`, or an older `nodejs_compat_v2`). */
function hasNodeCompat({ flags }: HasNodeCompatInput): boolean {
  return Array.isArray(flags) && flags.some((flag) => typeof flag === "string" && flag.startsWith("nodejs_compat"));
}

const DEPLOYMENT_DOCS = "https://dropletsjs.dev/guides/deployment/";

const IMMUTABLE = "public, max-age=2592000, immutable";

type HeadersBlockInput = { publicCacheControl: string | false };

/**
 * The adapter's rules for `dist/client/_headers`. Cloudflare applies every
 * rule that matches and joins repeated headers, so each rule detaches
 * `Cache-Control` first: the default of static assets, and on
 * `/assets/public/*` the immutable one `/assets/*` gave it.
 */
function headersBlock({ publicCacheControl }: HeadersBlockInput): string {
  const files = (path: string, cacheControl: string) =>
    `${path}\n  Access-Control-Allow-Origin: *\n  X-Content-Type-Options: nosniff\n  ! Cache-Control\n  Cache-Control: ${cacheControl}\n`;
  const publicRule = `/assets/public/*\n  ! Cache-Control\n${publicCacheControl === false ? "" : `  Cache-Control: ${publicCacheControl}\n`}`;
  return [
    files("/index.js", "no-store"),
    files("/index.css", "no-store"),
    files("/assets/*", IMMUTABLE),
    publicRule,
    files("/droplets/:id/client.js", IMMUTABLE),
    files("/droplets/:id/style.css", IMMUTABLE),
  ].join("");
}

const MAX_RULES = 100;
const MAX_LINE = 2000;

type HeadersLimitsInput = { text: string };

/** What breaks Cloudflare's `_headers` limits, `null` when nothing does. */
function headersOverLimits({ text }: HeadersLimitsInput): string | null {
  const lines = text.split("\n");
  const rules = lines.filter((line) => line.trim() !== "" && !/^\s/.test(line) && !line.startsWith("#")).length;
  const long = lines.filter((line) => line.length > MAX_LINE).length;
  if (rules <= MAX_RULES && long === 0) return null;
  return [rules > MAX_RULES ? `${rules} rules` : "", long > 0 ? `${long} ${long === 1 ? "line" : "lines"} over ${MAX_LINE} characters` : ""]
    .filter(Boolean)
    .join(" and ");
}

type MatchesGlobInput = { pattern: string; path: string };

/** Whether a `run_worker_first` pattern matches `path`; `*` stands for anything, `/` included. */
function matchesGlob({ pattern, path }: MatchesGlobInput): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(path);
}

type WorkerFirstPathsInput = { value: unknown; paths: readonly string[] };

/**
 * Which of `paths` a `run_worker_first` value sends through the Worker:
 * all of them for `true`; for a list, those a pattern matches and no `!`
 * pattern excludes (negative patterns win).
 */
function workerFirstPaths({ value, paths }: WorkerFirstPathsInput): string[] {
  if (value === true) return [...paths];
  if (!Array.isArray(value)) return [];
  const patterns = value.filter((entry): entry is string => typeof entry === "string");
  const included = patterns.filter((pattern) => !pattern.startsWith("!"));
  const excluded = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
  return paths.filter(
    (path) => included.some((pattern) => matchesGlob({ pattern, path })) && !excluded.some((pattern) => matchesGlob({ pattern, path })),
  );
}

type FilePathsInput = { manifestPath: string };

/** URL paths of the build's files that `_headers` covers: generic ones, and each droplet's from the manifest. */
async function filePaths({ manifestPath }: FilePathsInput): Promise<string[]> {
  const paths = [
    "/index.js",
    "/index.css",
    "/assets/index.js",
    "/assets/public/index.txt",
    "/droplets/x/client.js",
    "/droplets/x/style.css",
  ];
  let manifest: DropletsManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as DropletsManifest;
  } catch {
    // No manifest to read: the generic paths stand.
    return paths;
  }
  if (manifest.__entryModule) paths.push(`/${manifest.__entryModule}`);
  for (const [id, entry] of Object.entries(manifest.droplets ?? {})) {
    if (entry.client) paths.push(`/${entry.client}`);
    if (entry.css?.length) paths.push(`/droplets/${id}/style.css`);
  }
  return paths;
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
 * client build in `dist/client` is served through Workers Static Assets,
 * with the headers of the `dist/client/_headers` it writes; what is no file
 * reaches the Worker.
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
 *   "compatibility_flags": ["nodejs_compat"],   // the request store uses AsyncLocalStorage
 *   "assets": { "directory": "dist/client", "binding": "ASSETS" }
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
        conditions: ["workerd", "worker", ...defaultServerConditions.filter((condition) => condition !== "node")],
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
    async afterBuild({ root, outDir, manifestPath, serverPath, config }) {
      const client = resolve(outDir, "client");
      await writeFile(resolve(client, ".assetsignore"), ASSETS_IGNORE);
      const own = existsSync(resolve(root, USER_HEADERS)) ? await readFile(resolve(root, USER_HEADERS), "utf8") : "";
      const headers = `${headersBlock({ publicCacheControl: config.publicCacheControl })}${own ? `\n${own}` : ""}`;
      await writeFile(resolve(client, "_headers"), headers);
      const over = headersOverLimits({ text: headers });
      if (over) {
        logger.warn(
          "framework",
          `dist/client/_headers has ${over}: Cloudflare takes up to ${MAX_RULES} rules and ${MAX_LINE} characters per line; trim ${USER_HEADERS}, see ${DEPLOYMENT_DOCS}#_headers`,
        );
      }
      if (existsSync(resolve(client, "assets/public/_headers"))) {
        logger.warn(
          "framework",
          `public/_headers lands at /assets/public/_headers, where Cloudflare never reads it; move your rules to ${USER_HEADERS} in the project root, which the adapter appends to dist/client/_headers, see ${DEPLOYMENT_DOCS}#_headers`,
        );
      }

      const file = WRANGLER_CONFIGS.find((name) => existsSync(resolve(root, name)));
      if (!file) {
        logger.info(
          "framework",
          `no wrangler config found; point "main" at ${serverPath} and "assets.directory" at dist/client, with "assets.binding": ${JSON.stringify(assetsBinding)}`,
        );
        return;
      }
      let read: WranglerConfig;
      try {
        read = readWranglerConfig({ file, text: await readFile(resolve(root, file), "utf8") });
      } catch {
        // Text this reader does not parse (broken JSON, a TOML value JSON does not take): warn, never fail the build.
        logger.warn(
          "framework",
          `could not read ${file} (assets.run_worker_first, compatibility_flags); leave run_worker_first out so static assets serve the build's files with dist/client/_headers, and set compatibility_flags to ["nodejs_compat"], see ${DEPLOYMENT_DOCS}#cloudflare-workers`,
        );
        return;
      }
      if (!hasNodeCompat({ flags: read.compatibilityFlags })) {
        logger.warn(
          "framework",
          `${file}: compatibility_flags has no "nodejs_compat", so the Worker has no AsyncLocalStorage and requests that overlap share one request store; set "compatibility_flags": ["nodejs_compat"], see ${DEPLOYMENT_DOCS}#cloudflare-workers`,
        );
      }
      const value = read.runWorkerFirst;
      const matched = workerFirstPaths({ value, paths: await filePaths({ manifestPath }) });
      if (matched.length > 0) {
        const shown = matched.length > 5 ? `${matched.slice(0, 5).join(", ")}, …` : matched.join(", ");
        logger.warn(
          "framework",
          `${file}: assets.run_worker_first is ${JSON.stringify(value)}, so build files (${shown}) go through the Worker, billed per request; dist/client/_headers already gives them their CORS and cache headers, so leave run_worker_first out, see ${DEPLOYMENT_DOCS}#run_worker_first`,
        );
      }
    },
  };
}

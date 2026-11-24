import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DropletsAdapter, DropletsManifest, FileHeaderRule } from "@dropletsjs/droplets";
import { logger } from "@dropletsjs/droplets/vite";
import { defaultServerConditions } from "vite";
import {
  CLOUDFLARE_HEADERS_OVER_LIMITS,
  CLOUDFLARE_HTML_HANDLING_NONE,
  CLOUDFLARE_HTML_HANDLING_TRAILING_SLASH,
  CLOUDFLARE_NODEJS_COMPAT_MISSING,
  CLOUDFLARE_PUBLIC_HEADERS_IGNORED,
  CLOUDFLARE_RUN_WORKER_FIRST,
  CLOUDFLARE_WRANGLER_UNREADABLE,
} from "@dropletsjs/droplets/errors";

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
type WranglerConfig = { runWorkerFirst: unknown; compatibilityFlags: unknown; htmlHandling: unknown };

type TomlValueInput = { section: string; key: string };

/** The JSON value of `key = …` in a TOML section's text (`[`, `]`, strings, booleans), `undefined` when the line is absent. */
function tomlValue({ section, key }: TomlValueInput): unknown {
  const value = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*(?:#.*)?$`, "m").exec(section)?.[1];
  return value === undefined ? undefined : JSON.parse(value.replace(/'/g, '"'));
}

/** `assets.run_worker_first`, `assets.html_handling` and the top-level `compatibility_flags` of a wrangler config's text; throws when the text does not parse. */
function readWranglerConfig({ file, text }: ReadWranglerConfigInput): WranglerConfig {
  if (file.endsWith(".toml")) {
    const top = /^([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text)?.[1] ?? "";
    const assets = /^\[assets\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text)?.[1] ?? "";
    return {
      runWorkerFirst: tomlValue({ section: assets, key: "run_worker_first" }),
      compatibilityFlags: tomlValue({ section: top, key: "compatibility_flags" }),
      htmlHandling: tomlValue({ section: assets, key: "html_handling" }),
    };
  }
  const config = JSON.parse(toJson({ text })) as {
    assets?: { run_worker_first?: unknown; html_handling?: unknown };
    compatibility_flags?: unknown;
  };
  return {
    runWorkerFirst: config.assets?.run_worker_first,
    compatibilityFlags: config.compatibility_flags,
    htmlHandling: config.assets?.html_handling,
  };
}

type HasNodeCompatInput = { flags: unknown };

/** Whether `compatibility_flags` turns Node compatibility on (`nodejs_compat`, or an older `nodejs_compat_v2`). */
function hasNodeCompat({ flags }: HasNodeCompatInput): boolean {
  return Array.isArray(flags) && flags.some((flag) => typeof flag === "string" && flag.startsWith("nodejs_compat"));
}

/** Where `vite build` writes the prerender files an entry's `file` names, in `dist/client`. */
const PRERENDERED_FILES = "assets/prerendered";

type PatternsInput = { wider: string; narrower: string };

/** Whether every path the `narrower` pattern matches, the `wider` one matches too. */
function covers({ wider, narrower }: PatternsInput): boolean {
  const outer = wider.split("/");
  const inner = narrower.split("/");
  for (const [index, segment] of outer.entries()) {
    if (segment === "*" && index === outer.length - 1) return inner.length > index;
    const part = inner[index];
    if (part === undefined || part === "*") return false;
    if (!segment.startsWith(":") && part !== segment) return false;
  }
  return inner.length === outer.length;
}

type OverlapInput = { a: string; b: string };

/** Whether some path matches both patterns. */
function overlaps({ a, b }: OverlapInput): boolean {
  const left = a.split("/");
  const right = b.split("/");
  for (let index = 0; ; index++) {
    const l = left[index];
    const r = right[index];
    if (l === undefined || r === undefined) return l === r;
    if ((l === "*" && index === left.length - 1) || (r === "*" && index === right.length - 1)) return true;
    if (!l.startsWith(":") && !r.startsWith(":") && l !== r) return false;
  }
}

/** What static assets send on their own, whatever `_headers` says: detached before a rule sets it. */
const PLATFORM_HEADERS = ["Cache-Control"];

type RuleLinesInput = { rule: FileHeaderRule; earlier: readonly FileHeaderRule[] };

/**
 * The header lines of one rule. Cloudflare applies every rule that matches
 * and joins repeated headers, where the table gives a path its last matching
 * rule alone: a rule sets only what differs from the last wider rule before
 * it, and detaches (`! Name`) what it replaces or leaves out.
 */
function ruleLines({ rule, earlier }: RuleLinesInput): string[] {
  const parentIndex = earlier.findLastIndex((before) => covers({ wider: before.path, narrower: rule.path }));
  const inherited = Object.entries(earlier[parentIndex]?.headers ?? {});
  // Lowercase name to name: headers whose value on this rule's paths is not known here.
  const unknown = new Map(PLATFORM_HEADERS.map((name) => [name.toLowerCase(), name]));
  for (const before of earlier.slice(parentIndex + 1)) {
    if (!overlaps({ a: before.path, b: rule.path })) continue;
    for (const name of Object.keys(before.headers)) unknown.set(name.toLowerCase(), name);
  }
  const parent = new Map(inherited.map(([name, value]) => [name.toLowerCase(), value]));
  const own = new Set(Object.keys(rule.headers).map((name) => name.toLowerCase()));
  const lines: string[] = [];
  for (const [name, value] of Object.entries(rule.headers)) {
    const key = name.toLowerCase();
    if (!unknown.has(key) && parent.get(key) === value) continue;
    if (unknown.has(key) || parent.has(key)) lines.push(`! ${name}`);
    lines.push(`${name}: ${value}`);
  }
  const left = new Map([...inherited.map(([name]) => [name.toLowerCase(), name] as const), ...unknown]);
  for (const [key, name] of left) if (!own.has(key)) lines.push(`! ${name}`);
  return lines;
}

type HeadersBlockInput = { table: readonly FileHeaderRule[] };

/** The adapter's rules for `dist/client/_headers`, from the file-header table, in its order. */
function headersBlock({ table }: HeadersBlockInput): string {
  return table
    .map(
      (rule, index) =>
        `${rule.path}\n${ruleLines({ rule, earlier: table.slice(0, index) })
          .map((line) => `  ${line}\n`)
          .join("")}`,
    )
    .join("");
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
    "/assets/prerendered/x/y",
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
    async afterBuild({ root, outDir, manifestPath, serverPath, fileHeaders }) {
      const client = resolve(outDir, "client");
      await writeFile(resolve(client, ".assetsignore"), ASSETS_IGNORE);
      const own = existsSync(resolve(root, USER_HEADERS)) ? await readFile(resolve(root, USER_HEADERS), "utf8") : "";
      const headers = `${headersBlock({ table: fileHeaders })}${own ? `\n${own}` : ""}`;
      await writeFile(resolve(client, "_headers"), headers);
      const over = headersOverLimits({ text: headers });
      if (over) {
        logger.report({ message: CLOUDFLARE_HEADERS_OVER_LIMITS, params: { over, rules: MAX_RULES, line: MAX_LINE, file: USER_HEADERS } });
      }
      if (existsSync(resolve(client, "assets/public/_headers"))) {
        logger.report({ message: CLOUDFLARE_PUBLIC_HEADERS_IGNORED, params: { file: USER_HEADERS } });
      }

      const file = WRANGLER_CONFIGS.find((name) => existsSync(resolve(root, name)));
      if (!file) {
        logger.info(
          `no wrangler config found; point "main" at ${serverPath} and "assets.directory" at dist/client, with "assets.binding": ${JSON.stringify(assetsBinding)}`,
        );
        return;
      }
      let read: WranglerConfig;
      try {
        read = readWranglerConfig({ file, text: await readFile(resolve(root, file), "utf8") });
      } catch {
        // Text this reader does not parse (broken JSON, a TOML value JSON does not take): warn, never fail the build.
        logger.report({ message: CLOUDFLARE_WRANGLER_UNREADABLE, file });
        return;
      }
      if (!hasNodeCompat({ flags: read.compatibilityFlags })) {
        logger.report({ message: CLOUDFLARE_NODEJS_COMPAT_MISSING, file });
      }
      const files = "/assets/prerendered/<id>/<file>";
      if (read.htmlHandling === "none" && existsSync(resolve(client, PRERENDERED_FILES))) {
        logger.report({ message: CLOUDFLARE_HTML_HANDLING_NONE, params: { files }, file });
      }
      if (read.htmlHandling === "force-trailing-slash" && existsSync(resolve(client, PRERENDERED_FILES))) {
        logger.report({ message: CLOUDFLARE_HTML_HANDLING_TRAILING_SLASH, params: { files }, file });
      }
      const value = read.runWorkerFirst;
      const matched = workerFirstPaths({ value, paths: await filePaths({ manifestPath }) });
      if (matched.length > 0) {
        const shown = matched.length > 5 ? `${matched.slice(0, 5).join(", ")}, …` : matched.join(", ");
        logger.report({ message: CLOUDFLARE_RUN_WORKER_FIRST, params: { value: JSON.stringify(value), shown }, file });
      }
    },
  };
}

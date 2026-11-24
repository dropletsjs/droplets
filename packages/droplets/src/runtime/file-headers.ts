import type { ResolvedDropletsConfig } from "../core/config.ts";

/**
 * The headers of the build's files under one URL path pattern. `path` is a
 * pathname where a `:name` segment matches any one segment and a final `*`
 * matches whatever follows the slash before it (`/assets/*`,
 * `/droplets/:id/client.js`). `headers` are all the headers of the table a
 * matching file gets: a header another rule sets and this one leaves out is
 * not sent (an adapter removes its platform's default for it).
 */
export type FileHeaderRule = {
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
};

/** What `fileHeaderTable` reads of the resolved config. */
export type FileHeaderConfig = Pick<ResolvedDropletsConfig, "publicCacheControl">;

const IMMUTABLE = "public, max-age=2592000, immutable";

// Public files, loaded as modules and fonts from any page: CORS for any origin, whatever `cors` says.
const FILE = { "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" };

/**
 * The headers of every file `vite build` writes for the browser, from the
 * resolved config, as an ordered table: a narrower pattern comes after the
 * wider one it refines, so for a path the last rule that matches wins.
 */
export function fileHeaderTable(config: FileHeaderConfig): FileHeaderRule[] {
  const { publicCacheControl } = config;
  return [
    { path: "/index.js", headers: { ...FILE, "Cache-Control": "no-store" } },
    { path: "/index.css", headers: { ...FILE, "Cache-Control": "no-store" } },
    { path: "/assets/*", headers: { ...FILE, "Cache-Control": IMMUTABLE } },
    {
      path: "/assets/public/*",
      headers: { ...FILE, ...(publicCacheControl === false ? {} : { "Cache-Control": publicCacheControl }) },
    },
    { path: "/droplets/:id/client.js", headers: { ...FILE, "Cache-Control": IMMUTABLE } },
    { path: "/droplets/:id/style.css", headers: { ...FILE, "Cache-Control": IMMUTABLE } },
  ];
}

type MatchesFilePathInput = { pattern: string; path: string };

/** Whether `path` matches a `FileHeaderRule` pattern. */
function matchesFilePath({ pattern, path }: MatchesFilePathInput): boolean {
  const wanted = pattern.split("/");
  // `//` reaches the same file as `/` on a file system.
  const parts = path.replace(/\/{2,}/g, "/").split("/");
  for (const [index, segment] of wanted.entries()) {
    if (segment === "*" && index === wanted.length - 1) return parts.slice(index).join("/") !== "";
    const part = parts[index];
    if (part === undefined) return false;
    if (segment.startsWith(":") ? part === "" : part !== segment) return false;
  }
  return parts.length === wanted.length;
}

type FileHeadersForInput = { table: readonly FileHeaderRule[]; path: string };

/** The headers of the last rule whose pattern matches `path`, `undefined` when none does. */
export function fileHeadersFor({ table, path }: FileHeadersForInput): Readonly<Record<string, string>> | undefined {
  return table.findLast((rule) => matchesFilePath({ pattern: rule.path, path }))?.headers;
}

type ApplyFileHeadersInput = { table: readonly FileHeaderRule[]; path: string; headers: Headers };

/**
 * `headers` with the matching rule applied: its headers set, every other
 * header the table names removed. `false` when no rule matches, and
 * `headers` is left as it is.
 */
export function applyFileHeaders({ table, path, headers }: ApplyFileHeadersInput): boolean {
  const own = fileHeadersFor({ table, path });
  if (!own) return false;
  for (const rule of table) {
    for (const name of Object.keys(rule.headers)) headers.delete(name);
  }
  for (const [name, value] of Object.entries(own)) headers.set(name, value);
  return true;
}

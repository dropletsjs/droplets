import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ImportMap } from "../runtime/server.ts";

/** The installed version of `name`, looking up from `root` like Node does. */
export function installedVersion(root: string, name: string): string | null {
  let dir = root;
  for (;;) {
    const manifest = join(dir, "node_modules", name, "package.json");
    if (existsSync(manifest)) {
      try {
        const version = (JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown }).version;
        return typeof version === "string" ? version : null;
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `https://cdn.jsdelivr.net/npm/ag-grid-community@34.1.0/+esm` -> `34.1.0`. */
export function versionInUrl(url: string, name: string): string | null {
  const match = url.match(new RegExp(`${escape(name)}@(\\d+\\.\\d+\\.\\d+[\\w.+-]*)`));
  return match?.[1] ?? null;
}

/**
 * What is likely wrong with an import map, as sentences. Checks the plain
 * `imports`; scopes are the author's own business.
 */
export function checkImportMap(
  map: ImportMap,
  externals: string[],
  root: string,
): string[] {
  const imports = map.imports ?? {};
  const warnings: string[] = [];

  for (const name of externals) {
    if (!(name in imports)) {
      warnings.push(`${name} is external but the import map does not map it; the browser cannot load it`);
    }
  }
  for (const [name, url] of Object.entries(imports)) {
    if (name.startsWith("/@id/")) continue;
    if (!externals.includes(name)) {
      warnings.push(`the import map maps ${name}, which is not external; it is bundled and the entry is unused`);
      continue;
    }
    const wanted = versionInUrl(url, name);
    const installed = installedVersion(root, name);
    if (wanted && installed && wanted !== installed) {
      warnings.push(
        `${name}: the import map loads ${wanted} in the browser, the server renders with ${installed}; hydration may not match`,
      );
    }
  }
  return warnings;
}

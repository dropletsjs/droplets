import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { IMPORT_MAP_ENTRY_UNUSED, IMPORT_MAP_EXTERNAL_UNMAPPED, IMPORT_MAP_VERSION_MISMATCH } from "../errors/build.ts";
import type { ImportMap } from "../runtime/server.ts";

/** The installed version of `name`, looking up from `root` like Node does. */
type InstalledVersionInput = { root: string; name: string };

export function installedVersion({ root, name }: InstalledVersionInput): string | null {
  let dir = root;
  for (;;) {
    const manifest = join(dir, "node_modules", name, "package.json");
    if (existsSync(manifest)) {
      try {
        const version = (JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown }).version;
        return typeof version === "string" ? version : null;
      } catch {
        // A package.json that is not JSON has no version to compare.
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

type EscapeRegExpInput = { value: string };

function escapeRegExp({ value }: EscapeRegExpInput): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `https://cdn.jsdelivr.net/npm/ag-grid-community@34.1.0/+esm` -> `34.1.0`. */
type VersionInUrlInput = { url: string; name: string };

export function versionInUrl({ url, name }: VersionInUrlInput): string | null {
  const match = url.match(new RegExp(`${escapeRegExp({ value: name })}@(\\d+\\.\\d+\\.\\d+[\\w.+-]*)`));
  return match?.[1] ?? null;
}

/** One finding of `checkImportMap`, ready for `logger.report`. */
export type ImportMapWarning =
  | { message: typeof IMPORT_MAP_EXTERNAL_UNMAPPED; params: { name: string } }
  | { message: typeof IMPORT_MAP_ENTRY_UNUSED; params: { name: string } }
  | { message: typeof IMPORT_MAP_VERSION_MISMATCH; params: { name: string; wanted: string; installed: string } };

/**
 * What is likely wrong with an import map. Checks the plain `imports`;
 * scopes are the author's own business.
 */
type CheckImportMapInput = { map: ImportMap; externals: readonly string[]; root: string };

export function checkImportMap({ map, externals, root }: CheckImportMapInput): ImportMapWarning[] {
  const imports = map.imports ?? {};
  const warnings: ImportMapWarning[] = [];

  for (const name of externals) {
    if (!(name in imports)) {
      warnings.push({ message: IMPORT_MAP_EXTERNAL_UNMAPPED, params: { name } });
    }
  }
  for (const [name, url] of Object.entries(imports)) {
    if (name.startsWith("/@id/")) continue;
    if (!externals.includes(name)) {
      warnings.push({ message: IMPORT_MAP_ENTRY_UNUSED, params: { name } });
      continue;
    }
    const wanted = versionInUrl({ url, name });
    const installed = installedVersion({ root, name });
    if (wanted && installed && wanted !== installed) {
      warnings.push({ message: IMPORT_MAP_VERSION_MISMATCH, params: { name, wanted, installed } });
    }
  }
  return warnings;
}

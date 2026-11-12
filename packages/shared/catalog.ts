/**
 * The `catalog:` of pnpm-workspace.yaml: the tool ranges the workspace is
 * built with, which create-droplets writes into new projects and the
 * examples declare literally (users copy them).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type CatalogRangesInput = { yaml: string };

/**
 * The `catalog:` block: one `name: range` per line, the name quoted when it
 * is scoped. Nothing else of YAML is needed here.
 */
export function catalogRanges({ yaml }: CatalogRangesInput): Record<string, string> {
  const ranges: Record<string, string> = {};
  let inCatalog = false;
  for (const line of yaml.split("\n")) {
    if (/^catalog:\s*$/.test(line)) {
      inCatalog = true;
      continue;
    }
    if (!inCatalog || /^\s*(#|$)/.test(line)) continue;
    if (!/^\s/.test(line)) break;
    const entry = /^\s+(?:"([^"]+)"|'([^']+)'|([^\s:]+)):\s*["']?([^"'\s#]+)["']?/.exec(line);
    const name = entry?.[1] ?? entry?.[2] ?? entry?.[3];
    const range = entry?.[4];
    if (name !== undefined && range !== undefined) ranges[name] = range;
  }
  return ranges;
}

/** The workspace's own catalog, read from the root pnpm-workspace.yaml. */
export function workspaceCatalog(): Record<string, string> {
  return catalogRanges({ yaml: readFileSync(fileURLToPath(new URL("../../pnpm-workspace.yaml", import.meta.url)), "utf8") });
}

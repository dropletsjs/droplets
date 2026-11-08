/**
 * The versions a generated project asks for, read from the workspace when
 * create-droplets is built (or tested) and baked into it as
 * `__VERSIONS__`: each `@dropletsjs/*` package at its own version, the
 * tools at the ranges of the workspace's pnpm catalog (pnpm-workspace.yaml),
 * which every example and test is built with.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")) as {
    name: string;
    version: string;
  };

const PACKAGES = [
  "../droplets",
  "../devtools",
  "../adapters/node",
  "../adapters/cloudflare",
  "../adapters/bun",
  "../adapters/deno",
  "../renderers/svelte",
  "../renderers/vue",
  "../renderers/react",
  "../renderers/preact",
  "../renderers/solid",
  "../renderers/hono-jsx",
  "../renderers/handlebars",
  "../renderers/lit",
];

const TOOLS = ["vite", "typescript", "@types/node", "tailwindcss", "@tailwindcss/vite", "wrangler", "@types/react", "@types/react-dom"];

/**
 * The `catalog:` block of pnpm-workspace.yaml: one `name: range` per line,
 * the name quoted when it is scoped. Nothing else of YAML is needed here.
 */
export function catalogRanges(yaml: string): Record<string, string> {
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
    if (entry) ranges[entry[1] ?? entry[2] ?? entry[3]!] = entry[4]!;
  }
  return ranges;
}

export function workspaceVersions(): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const path of PACKAGES) {
    const pkg = read(`${path}/package.json`);
    versions[pkg.name] = `^${pkg.version}`;
  }
  const ranges = catalogRanges(readFileSync(fileURLToPath(new URL("../../pnpm-workspace.yaml", import.meta.url)), "utf8"));
  for (const tool of TOOLS) {
    const range = ranges[tool];
    if (!range) throw new Error(`the pnpm catalog in pnpm-workspace.yaml has no ${tool}`);
    versions[tool] = range;
  }
  return versions;
}

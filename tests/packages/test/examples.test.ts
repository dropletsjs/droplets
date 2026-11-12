/**
 * The examples declare the published ranges, since users copy them: every
 * `@dropletsjs/*` dependency at `^<the packages' version>`, every tool of
 * the pnpm catalog at the catalog's literal range, and no `workspace:` or
 * `catalog:` range anywhere under `examples/`. Inside the repository pnpm
 * links the workspace packages for those ranges (`linkWorkspacePackages`).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { workspaceCatalog } from "@dropletsjs/shared/catalog";
import { describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "../../..");
const examples = join(repo, "examples");

type Manifest = { name?: string; version?: string } & Record<string, Record<string, string> | undefined>;
const readManifest = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Manifest;
const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** Installed, built or generated: not the example's own files. */
const GENERATED = new Set(["node_modules", "dist", "build", ".next", ".svelte-kit", ".astro", ".venv", ".droplets", ".tmp", "__pycache__"]);

function manifestsUnder(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return GENERATED.has(entry.name) ? [] : manifestsUnder(join(folder, entry.name));
    return entry.name === "package.json" ? [join(folder, entry.name)] : [];
  });
}

/** The published packages' versions by name, from `packages/`. */
function publishedVersions(): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const folder of ["droplets", "devtools", "create-droplets", "adapters", "renderers"]) {
    for (const file of manifestsUnder(join(repo, "packages", folder))) {
      const { name, version } = readManifest(file);
      if (name && version && name !== "create-droplets") versions[name] = version;
    }
  }
  return versions;
}

const versions = publishedVersions();
const catalog = workspaceCatalog();
const foldersIn = (group: string) =>
  readdirSync(join(examples, group), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${group}/${entry.name}`);
const workspace = ["shop", "wp-shop", ...foldersIn("frameworks")];
const hosts = foldersIn("hosts");

const ranges = (file: string) =>
  FIELDS.flatMap((field) => Object.entries(readManifest(file)[field] ?? {}).map(([name, range]) => ({ field, name, range })));

describe("the examples declare the published ranges", () => {
  it("reads every published package's version", () => {
    expect(Object.keys(versions)).toHaveLength(14);
    expect(versions["@dropletsjs/droplets"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each([...workspace, ...hosts])("examples/%s has no workspace: or catalog: range", (example) => {
    const found: string[] = [];
    for (const file of manifestsUnder(join(examples, example))) {
      for (const { field, name, range } of ranges(file)) {
        if (/^(?:workspace|catalog):/.test(range)) found.push(`${relative(examples, file)}: ${field}.${name} = ${range}`);
      }
    }
    expect(found).toEqual([]);
  });

  it.each([...workspace, ...hosts])("examples/%s asks for @dropletsjs/* at ^<version>", (example) => {
    const found: string[] = [];
    for (const file of manifestsUnder(join(examples, example))) {
      for (const { field, name, range } of ranges(file)) {
        if (!name.startsWith("@dropletsjs/")) continue;
        const version = versions[name];
        if (!version) found.push(`${relative(examples, file)}: ${field}.${name} is not a published package`);
        else if (range !== `^${version}`) found.push(`${relative(examples, file)}: ${field}.${name} = ${range}, expected ^${version}`);
      }
    }
    expect(found).toEqual([]);
  });

  // The hosts bring their own toolchains (a lockfile each), so only the workspace examples follow the catalog.
  it.each(workspace)("examples/%s asks for the catalog's tools at the catalog's ranges", (example) => {
    const found: string[] = [];
    for (const file of manifestsUnder(join(examples, example))) {
      for (const { field, name, range } of ranges(file)) {
        const expected = catalog[name];
        if (expected && range !== expected)
          found.push(`${relative(examples, file)}: ${field}.${name} = ${range}, the catalog says ${expected}`);
      }
    }
    expect(found).toEqual([]);
  });
});

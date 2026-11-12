/**
 * Every example stands on its own, since users copy it: `examples/shop`,
 * `examples/wp-shop`, each `examples/frameworks/*` and each
 * `examples/hosts/*` reaches nothing outside its own folder. No
 * `package.json` dependency is a `file:` or `link:` path, no source file
 * imports from above the example's root, and no `tsconfig` extends one.
 * (`workspace:` and `catalog:` ranges are the workspace's own and are not
 * checked here.)
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const examples = resolve(import.meta.dirname, "../../../examples");

const roots = [
  join(examples, "shop"),
  join(examples, "wp-shop"),
  ...["frameworks", "hosts"].flatMap((group) =>
    readdirSync(join(examples, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(examples, group, entry.name)),
  ),
];

/** Installed, built or generated: not the example's own sources. */
const GENERATED = new Set(["node_modules", "dist", "build", ".next", ".svelte-kit", ".astro", ".venv", ".droplets", ".tmp", "__pycache__"]);

const SOURCE = /\.(?:[cm]?[jt]sx?|svelte|vue|astro)$/;

/** The example's own files, never descending into a generated folder (a host's `node_modules` is large). */
function filesUnder(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return GENERATED.has(entry.name) ? [] : filesUnder(join(folder, entry.name));
    return entry.isFile() ? [join(folder, entry.name)] : [];
  });
}

/** The relative specifiers a file imports, re-exports or loads: `from "./x"`, `import "./x"`, `import("./x")`. */
function relativeSpecifiers(text: string): string[] {
  return [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.\.?\/[^"']*)["']/g)].map((match) => match[1]!);
}

const isOutside = (root: string, target: string) => relative(root, target).startsWith("..");

describe.each(roots.map((root) => [relative(examples, root), root] as const))("examples/%s stands on its own", (_, root) => {
  const files = filesUnder(root);

  it("depends on no file: or link: path", () => {
    const found: string[] = [];
    for (const file of files.filter((path) => path.endsWith("package.json"))) {
      const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, string> | undefined>;
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        for (const [name, range] of Object.entries(manifest[field] ?? {})) {
          if (/^(?:file|link):/.test(range)) found.push(`${relative(root, file)}: ${field}.${name} = ${range}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("imports nothing from above its folder", () => {
    const found: string[] = [];
    for (const file of files.filter((path) => SOURCE.test(path))) {
      for (const specifier of relativeSpecifiers(readFileSync(file, "utf8"))) {
        if (isOutside(root, resolve(dirname(file), specifier))) found.push(`${relative(root, file)}: ${specifier}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("extends no tsconfig from above its folder", () => {
    const found: string[] = [];
    for (const file of files.filter((path) => /tsconfig[\w.-]*\.json$/.test(path))) {
      // The files carry comments, so no JSON.parse: the `extends` value as written.
      for (const [, target] of readFileSync(file, "utf8").matchAll(/"extends"\s*:\s*"([^"]+)"/g)) {
        if (target!.startsWith(".") && isOutside(root, resolve(dirname(file), target!))) found.push(`${relative(root, file)}: ${target}`);
      }
    }
    expect(found).toEqual([]);
  });
});

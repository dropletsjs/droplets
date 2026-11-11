/**
 * The published packages as npm packs them (`npm pack`, unpacked): what the
 * code resolves by path is there, server code is out of every client entry's
 * graph, nothing is imported that the consumer may not have, and no source
 * maps ship. The build checks the client graph itself
 * (packages/tsdown.config.base.ts); this checks the tarball.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAst } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isServerPath, type PackageOptions } from "../../../packages/tsdown.config.base.ts";

const packagesDir = fileURLToPath(new URL("../../../packages/", import.meta.url));

const PACKAGES = [
  "droplets",
  "devtools",
  "adapters/node",
  "adapters/cloudflare",
  "adapters/bun",
  "adapters/deno",
  "renderers/svelte",
  "renderers/vue",
  "renderers/react",
  "renderers/preact",
  "renderers/solid",
  "renderers/hono-jsx",
  "renderers/handlebars",
  "renderers/lit",
];

type PackageJson = {
  name: string;
  bin?: Record<string, string>;
  exports?: Record<string, string | Record<string, string>>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));

type Node = { type: string; [key: string]: unknown };

/** The module specifiers a file imports, statically or with a literal `import()`. */
function importsOf(code: string): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const n = node as Node;
    const source = n["source"] as Node | undefined;
    if (
      (n.type === "ImportDeclaration" || n.type === "ExportNamedDeclaration" || n.type === "ExportAllDeclaration" || n.type === "ImportExpression") &&
      source?.type === "Literal" &&
      typeof source["value"] === "string"
    ) {
      found.push(source["value"]);
    }
    for (const value of Object.values(n)) if (value && typeof value === "object") visit(value);
  };
  visit(parseAst(code));
  return found;
}

const root = mkdtempSync(join(tmpdir(), "droplets-packed-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe.each(PACKAGES)("%s, packed", (path) => {
  const source = join(packagesDir, path);
  const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8")) as PackageJson;
  const unpacked = join(root, path.replaceAll("/", "-"));
  let options: PackageOptions;
  let files: string[] = [];
  const at = (file: string) => join(unpacked, file);
  const has = (file: string) => files.includes(posix.normalize(file.replace(/^\.\//, "")));

  beforeAll(async () => {
    options = ((await import(join(source, "tsdown.config.ts"))) as { options: PackageOptions }).options;
    mkdirSync(unpacked, { recursive: true });
    const [{ filename }] = JSON.parse(
      execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", unpacked], {
        cwd: source,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ) as [{ filename: string }];
    execFileSync("tar", ["-xzf", join(unpacked, filename), "-C", unpacked, "--strip-components=1"]);
    rmSync(join(unpacked, filename));
    files = walk(unpacked).map((file) => relative(unpacked, file).replaceAll("\\", "/"));
  });

  it("ships no source maps", () => {
    expect(files.filter((file) => file.endsWith(".map"))).toEqual([]);
  });

  it("has every file `exports` and `bin` point at, and what the launchers import", () => {
    const targets = Object.values(pkg.exports ?? {}).flatMap((value) => (typeof value === "string" ? [value] : Object.values(value)));
    for (const target of targets) expect(has(target), target).toBe(true);
    for (const bin of Object.values(pkg.bin ?? {})) {
      expect(has(bin), bin).toBe(true);
      for (const specifier of importsOf(readFileSync(at(bin), "utf8"))) {
        expect(has(posix.join(posix.dirname(bin), specifier)), `${bin} imports ${specifier}`).toBe(true);
      }
    }
  });

  it("has every entry the code resolves by path at its fixed place, with its types", () => {
    for (const entry of options.entry) {
      expect(has(`dist/${entry}.js`), entry).toBe(true);
      expect(has(`dist/${entry}.d.ts`), entry).toBe(true);
    }
  });

  it("ships the as-is files unchanged", () => {
    for (const file of options.asIs ?? []) {
      expect(readFileSync(at(`dist/${file}`), "utf8"), file).toBe(readFileSync(join(source, "src", file), "utf8"));
    }
  });

  it("keeps server code out of what the client entries reach", () => {
    const serverEntries = new Set((options.server ?? []).filter((name) => options.entry.includes(name)).map((name) => `dist/${name}.js`));
    for (const entry of options.client ?? []) {
      const seen = new Set<string>();
      const queue = [[`dist/${entry}.js`]];
      for (let via = queue.shift(); via; via = queue.shift()) {
        const file = via.at(-1)!;
        if (seen.has(file)) continue;
        seen.add(file);
        const chain = via.join(" -> ");
        expect(isServerPath(file), `server code reached: ${chain}`).toBe(false);
        expect(serverEntries.has(file), `server entry reached: ${chain}`).toBe(false);
        expect(has(file), `missing: ${chain}`).toBe(true);
        if (!file.endsWith(".js")) continue; // an as-is component, compiled by the consumer
        for (const specifier of importsOf(readFileSync(at(file), "utf8"))) {
          expect(specifier.startsWith("node:"), `Node built-in reached: ${chain} -> ${specifier}`).toBe(false);
          if (specifier.startsWith(".")) queue.push([...via, posix.join(posix.dirname(file), specifier)]);
        }
      }
    }
  });

  it("imports only its dependencies and peers, Node built-ins and virtual modules", () => {
    const allowed = new Set([pkg.name, ...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
    const name = (id: string) => id.split("/").slice(0, id.startsWith("@") ? 2 : 1).join("/");
    for (const file of files.filter((file) => file.endsWith(".js") && file.startsWith("dist/"))) {
      for (const specifier of importsOf(readFileSync(at(file), "utf8"))) {
        if (/^(\.|node:|virtual:|\$droplets\/)/.test(specifier)) {
          if (specifier.startsWith(".")) expect(has(posix.join(posix.dirname(file), specifier)), `${file} imports ${specifier}`).toBe(true);
          continue;
        }
        expect(allowed.has(name(specifier)), `${file} imports ${specifier}`).toBe(true);
      }
    }
  });

  it("leaves import.meta.env.DEV and import.meta.hot to the consumer's Vite", () => {
    const sources = walk(join(source, "src")).filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".d.ts"));
    const dist = files.filter((file) => file.endsWith(".js")).map((file) => readFileSync(at(file), "utf8")).join("\n");
    for (const marker of ["import.meta.env.DEV", "import.meta.hot"]) {
      const used = sources.some((file) => readFileSync(file, "utf8").replace(/`[^`]*`|"[^"\n]*"/g, "").includes(marker));
      if (used) expect(dist, marker).toContain(marker);
    }
    expect(dist).not.toMatch(/import\.meta\.env\s*=|\{\s*DEV\s*:\s*(true|false)/);
  });

  it("keeps the JSDoc in the types, and keeps the *.css declaration out", () => {
    const types = files.filter((file) => file.endsWith(".d.ts"));
    expect(types.length).toBeGreaterThan(0);
    expect(types.some((file) => readFileSync(at(file), "utf8").includes("/**"))).toBe(true);
    expect(types.filter((file) => /(^|\/)css\.d\.ts$/.test(file) || readFileSync(at(file), "utf8").includes('"*.css"'))).toEqual([]);
  });

  it.runIf(path === "droplets")("keeps the @vite-ignore of the runtime's dynamic imports", () => {
    const code = readFileSync(at("dist/runtime/entry-client.js"), "utf8");
    expect(code.match(/import\(\s*\/\* @vite-ignore \*\//g)?.length).toBe(2);
  });
});

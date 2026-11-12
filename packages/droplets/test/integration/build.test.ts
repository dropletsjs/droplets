/**
 * What `vite build` leaves in `dist/` and how it must be run: a real build
 * of a one-droplet project, twice with different adapters, and Vite's plain
 * `build()` without the builder.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createBuilder } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));

const adapter = (serverFile: string): DropletsAdapter => ({
  name: `fake-${serverFile}`,
  serverEntry: resolve(fixtures, "app/fake-entry.js"),
  serverFile,
  separateSsrBundle: true,
});

async function project(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(fixtures, ".build-"));
  const all = { "src/droplets/card/+droplet.fake.js": "export default () => `<p>card</p>`;\n", ...files };
  for (const [path, text] of Object.entries(all)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

type BuildOptions = { outDir?: string; emptyOutDir?: boolean };

const buildWith = (root: string, serverFile: string, { outDir, emptyOutDir }: BuildOptions = {}) =>
  createBuilder({
    root,
    configFile: false,
    logLevel: "silent",
    build: { ...(outDir ? { outDir } : {}), ...(emptyOutDir === undefined ? {} : { emptyOutDir }) },
    plugins: [droplets({ adapter: adapter(serverFile), renderers: [fakeRenderer()] })],
  }).then((builder) => builder.buildApp());

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("vite build empties dist/ first", () => {
  it("leaves nothing of a build with another adapter behind", async () => {
    const root = await project();
    roots.push(root);
    await buildWith(root, "server.js");
    await writeFile(join(root, "dist/notes.txt"), "a file of the previous build");
    expect(existsSync(join(root, "dist/server.js"))).toBe(true);
    await buildWith(root, "worker.js");
    expect(existsSync(join(root, "dist/worker.js"))).toBe(true);
    expect(existsSync(join(root, "dist/server.js"))).toBe(false);
    expect(existsSync(join(root, "dist/notes.txt"))).toBe(false);
    expect(existsSync(join(root, "dist/client/droplets.json"))).toBe(true);
  }, 120_000);

  it("keeps an outDir outside the project, and one the user says to keep", async () => {
    const root = await project();
    roots.push(root);
    const outside = await mkdtemp(join(fixtures, ".build-out-"));
    roots.push(outside);
    await writeFile(join(outside, "keep.txt"), "not Vite's to remove");
    await buildWith(root, "server.js", { outDir: outside });
    expect(existsSync(join(outside, "keep.txt"))).toBe(true);
    expect(existsSync(join(outside, "server.js"))).toBe(true);

    await buildWith(root, "server.js");
    await writeFile(join(root, "dist/keep.txt"), "the user set emptyOutDir: false");
    await buildWith(root, "worker.js", { emptyOutDir: false });
    expect(existsSync(join(root, "dist/keep.txt"))).toBe(true);
    expect(existsSync(join(root, "dist/server.js"))).toBe(true);
    expect(existsSync(join(root, "dist/worker.js"))).toBe(true);
  }, 180_000);
});

describe("vite build needs the builder", () => {
  it("refuses Vite's plain build(), which builds one environment", async () => {
    const root = await project();
    roots.push(root);
    await expect(
      build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [droplets({ adapter: adapter("server.js"), renderers: [fakeRenderer()] })],
      }),
    ).rejects.toThrow(
      "droplets: vite build (the builder) is required; build() alone builds one environment; use createBuilder() or the vite build command",
    );
    expect(existsSync(join(root, "dist/client/droplets.json"))).toBe(false);
  }, 60_000);
});

describe("vite build with an index that does not exist", () => {
  it("fails as the config resolves, before anything is built", async () => {
    const root = await project({
      "droplets.config.js": 'export default { index: "home.html" };\n',
      "package.json": '{ "type": "module" }\n',
    });
    roots.push(root);
    await expect(buildWith(root, "server.js")).rejects.toThrow("droplets: index points at home.html, which does not exist");
    expect(existsSync(join(root, "dist"))).toBe(false);
    await writeFile(join(root, "home.html"), "<p>home</p>\n");
    await buildWith(root, "server.js");
    expect(JSON.parse(await readFile(join(root, "dist/client/droplets.json"), "utf8")).__index).toBe("<p>home</p>\n");
  }, 120_000);
});

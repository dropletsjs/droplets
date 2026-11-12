/**
 * Styles belong to the component: CSS reached from `+droplet.ts` fails a
 * real `vite build` and the dev server, and CSS imported as a string
 * (`?inline`) does not.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder, createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));

const fakeAdapter: DropletsAdapter = {
  name: "fake",
  serverEntry: resolve(fixtures, "app/fake-entry.js"),
  serverFile: "server.js",
  separateSsrBundle: true,
};

/** A project with one droplet whose `+droplet.ts` imports `style`. */
async function project(style: string): Promise<string> {
  const root = await mkdtemp(join(fixtures, ".load-css-"));
  const folder = join(root, "src/droplets/card");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "+droplet.fake.js"), 'export default () => `<p class="card">card</p>`;\n');
  await writeFile(join(folder, "+droplet.ts"), `import ${JSON.stringify(style)};\n\nexport const load = () => ({});\n`);
  await writeFile(join(folder, "card.css"), ".card { color: red; }\n");
  return root;
}

const build = (root: string) =>
  createBuilder({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [droplets({ adapter: fakeAdapter, renderers: [fakeRenderer()] })],
  }).then((builder) => builder.buildApp());

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("CSS from +droplet.ts", () => {
  it("fails the build, naming the file", async () => {
    const root = await project("./card.css");
    roots.push(root);
    await expect(build(root)).rejects.toThrow(
      "droplets: src/droplets/card/+droplet.ts imports CSS: src/droplets/card/+droplet.ts -> src/droplets/card/card.css. " +
        "Styles belong to the component",
    );
  }, 90_000);

  it("builds when it is a string (?inline)", async () => {
    const root = await project("./card.css?inline");
    roots.push(root);
    await build(root);
    expect(existsSync(join(root, "dist/client/droplets/card/client.js"))).toBe(true);
  }, 90_000);

  it("builds when it is a URL (?url)", async () => {
    const root = await project("./card.css?url");
    roots.push(root);
    await build(root);
    expect(existsSync(join(root, "dist/client/droplets/card/client.js"))).toBe(true);
  }, 90_000);

  describe("in vite dev", () => {
    let server: ViteDevServer;
    let root: string;

    beforeAll(async () => {
      root = await project("./card.css");
      roots.push(root);
      server = await createServer({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [droplets({ renderers: [fakeRenderer()] })],
        server: { middlewareMode: true, hmr: false, watch: null },
      });
    }, 60_000);

    afterAll(async () => {
      await server?.close();
    });

    it("is an error as the import resolves", async () => {
      await expect(server.environments.client.transformRequest("/src/droplets/card/+droplet.ts")).rejects.toThrow(
        "droplets: src/droplets/card/+droplet.ts imports CSS: src/droplets/card/+droplet.ts -> ./card.css.",
      );
    });
  });
});

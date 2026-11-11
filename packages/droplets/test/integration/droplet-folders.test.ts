/**
 * A droplet folder's name is its id and must be lowercase kebab-case: a
 * real `vite build` and `vite dev` ignore any other folder and warn once,
 * listing them.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder, createServer } from "vite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setLogLevel } from "../../src/core/logger.ts";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));

const fakeAdapter: DropletsAdapter = {
  name: "fake",
  serverEntry: resolve(fixtures, "app/fake-entry.js"),
  serverFile: "server.js",
  separateSsrBundle: true,
};

const MESSAGE =
  "[droplets:framework] These droplet folders do not match the naming convention (lowercase kebab-case) and are ignored: ProductCard, my_card";

const roots: string[] = [];

async function project(): Promise<string> {
  const root = await mkdtemp(join(fixtures, ".droplet-folders-"));
  roots.push(root);
  for (const folder of ["product-card", "ProductCard", "my_card"]) {
    const file = join(root, "src/droplets", folder, "+droplet.fake.js");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `export default () => \`<p>${folder}</p>\`;\n`);
  }
  return root;
}

type Spy = { mock: { calls: unknown[][] } };

function warnings(spy: Spy): string[] {
  return spy.mock.calls.map((call) => String(call[0])).filter((message) => message.includes("naming convention"));
}

beforeAll(() => setLogLevel("warn"));
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  setLogLevel("error");
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("droplet folder names", () => {
  it("vite build builds only the kebab-case folder and warns once", async () => {
    const root = await project();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [droplets({ adapter: fakeAdapter, renderers: [fakeRenderer()] })],
    });
    await builder.buildApp();
    const manifest = JSON.parse(await readFile(join(root, "dist/client/droplets.json"), "utf8"));
    expect(Object.keys(manifest.droplets)).toEqual(["product-card"]);
    expect(warnings(warn)).toEqual([MESSAGE]);
  }, 90_000);

  it("vite dev serves only the kebab-case folder and warns once", async () => {
    const root = await project();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [droplets({ renderers: [fakeRenderer()] })],
      server: { port: 0, hmr: false, watch: null },
    });
    try {
      await server.listen();
      const origin = server.resolvedUrls?.local[0]?.replace(/\/$/, "");
      expect(await (await fetch(`${origin}/droplets/product-card`)).text()).toContain("<p>product-card</p>");
      expect((await fetch(`${origin}/droplets/ProductCard`)).status).toBe(404);
      expect((await fetch(`${origin}/droplets/my_card`)).status).toBe(404);
      expect(warnings(warn)).toEqual([MESSAGE]);
    } finally {
      await server.close();
    }
  }, 90_000);
});

/**
 * A stylesheet with nothing in it is never generated: without a shared
 * stylesheet, a droplet with no CSS has no `style.css` (404, like
 * `/index.css`), and nothing links to, preloads or records one.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuilder, createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/core/config.ts";
import { createServerApp, type SsrModule } from "../../src/server/app.ts";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";

const root = fileURLToPath(new URL("../fixtures/app/", import.meta.url));
const outDir = resolve(root, "dist-empty-css");

const fakeAdapter: DropletsAdapter = {
  name: "fake",
  serverEntry: resolve(root, "fake-entry.js"),
  serverFile: "server.js",
  separateSsrBundle: true,
};

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

describe("vite build without a shared stylesheet", () => {
  beforeAll(async () => {
    await rm(outDir, { recursive: true, force: true });
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: "silent",
      build: { outDir },
      plugins: [droplets({ adapter: fakeAdapter, renderers: [fakeRenderer()], css: { path: false } })],
    });
    await builder.buildApp();
  }, 90_000);

  afterAll(() => rm(outDir, { recursive: true, force: true }));

  it("emits no empty file: no droplets-css.js, no empty shared stylesheet", async () => {
    const client = await files(resolve(outDir, "client"));
    for (const file of client) expect((await stat(file)).size, file).toBeGreaterThan(0);
    expect(client.filter((file) => /droplets-css/.test(file))).toEqual([]);
  });

  it("records, links and preloads only the stylesheets that exist", async () => {
    const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8"));
    expect(manifest.droplets.hello.css).toBeUndefined();
    expect(manifest.droplets.docs.css).toBeUndefined();
    expect(manifest.droplets["static-note"].css).toEqual([expect.stringMatching(/^assets\/.+\.css$/)]);
    const entry = await readFile(resolve(outDir, "client", manifest.__entryModule), "utf8");
    expect(entry).toContain('\\"static-note\\":');
    expect(entry).not.toMatch(/\\"(hello|docs|bare)\\":\[/);

    // The prerendered render links nothing either.
    for (const file of await files(resolve(outDir, "server/_prerendered"))) {
      expect(await readFile(file, "utf8"), file).not.toContain("style.css");
    }
  });

  it("answers 404 for /index.css and the style.css of a droplet without CSS, through the built server", async () => {
    const clientRoot = resolve(outDir, "client");
    const manifest = JSON.parse(await readFile(resolve(clientRoot, "droplets.json"), "utf8"));
    const ssr = (await import(pathToFileURL(resolve(outDir, "server/entry-server.js")).href)) as SsrModule;
    const read = async (path: string) => readFile(resolve(clientRoot, path), "utf8").catch(() => null);
    const app = createServerApp({
      ssr,
      config: resolveConfig({ element: "test-droplet" }),
      assets: {
        buildHash: manifest.__hash,
        loadClientModule: async () => null,
        loadEntryClient: async () => null,
        entryModule: async () => null,
        loadGlobalStyle: () => read(manifest.__globalCss),
        dropletStyles: async (id) => manifest.droplets[id]?.css ?? [],
        loadIndex: async () => null,
        externals: [],
        assetHandler: (c) => c.text("Not Found", 404),
      },
    });
    expect((await app.request("/index.css")).status).toBe(404);
    expect((await app.request("/droplets/hello/style.css")).status).toBe(404);
    const style = await app.request("/droplets/static-note/style.css");
    expect(style.status).toBe(200);
    // The same as a file of the build, for a host that serves files first; none for a droplet without CSS.
    expect(await readFile(resolve(clientRoot, "droplets/static-note/style.css"), "utf8")).toBe(await style.text());
    expect(existsSync(resolve(clientRoot, "droplets/hello/style.css"))).toBe(false);
    const fragment = await app.request("/droplets/hello?who=x");
    expect(await fragment.text()).not.toContain("data-droplet-style");
    expect(fragment.headers.get("link") ?? "").not.toContain(".css");
  });
});

describe("vite dev without a shared stylesheet", () => {
  let server: ViteDevServer;
  let origin: string;

  beforeAll(async () => {
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [droplets({ renderers: [fakeRenderer()], css: { path: false } })],
      server: { port: 0, hmr: false, watch: null },
    });
    await server.listen();
    origin = server.resolvedUrls?.local[0]?.replace(/\/$/, "") ?? "";
  }, 60_000);

  afterAll(() => server?.close());

  it("answers 404 for /index.css and every style.css", async () => {
    expect((await fetch(`${origin}/index.css`)).status).toBe(404);
    expect((await fetch(`${origin}/droplets/hello/style.css`)).status).toBe(404);
    expect((await fetch(`${origin}/droplets/static-note/style.css`)).status).toBe(404);
  });
});

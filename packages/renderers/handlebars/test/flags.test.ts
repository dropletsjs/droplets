// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createBuilder, createServer, type InlineConfig, type Plugin } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { droplets, type DropletsPluginApi } from "@dropletsjs/droplets/vite";
import { handlebars } from "../src/index.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "droplets-handlebars-flags-"));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
  }
  return root;
}

const fakeEntry = 'import manifest from "virtual:droplets-manifest";\nexport default manifest;\n';

const config = (root: string): InlineConfig => ({
  root,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true, hmr: false, watch: null },
  plugins: [droplets({ renderers: [handlebars()] })],
});

const buildConfig = (root: string): InlineConfig => ({
  ...config(root),
  plugins: [
    droplets({
      adapter: { name: "fake", serverEntry: join(root, "fake-entry.js"), serverFile: "server.js", separateSsrBundle: true },
      renderers: [handlebars()],
    }),
  ],
});

const api = (plugins: readonly Plugin[]): DropletsPluginApi =>
  plugins.find((plugin) => plugin.name === "droplets")?.api as DropletsPluginApi;

describe("flags of a Handlebars droplet", () => {
  it("come from the comment the template opens with", async () => {
    const root = await project({
      "src/droplets/card/+droplet.hbs": "{{!-- export hydrate = false; export prerender = true --}}\n<p>{{data.title}}</p>\n",
      "src/droplets/card/+droplet.ts": 'export const load = () => ({ title: "Hi" });\n',
    });
    const server = await createServer(config(root));
    try {
      expect(api(server.config.plugins).droplets()).toMatchObject([{ id: "card", ssr: true, hydrate: false }]);
    } finally {
      await server.close();
    }
  });

  it.each(["+droplet.ts", "+droplet.server.ts"])("are ignored in %s, in a build and in vite dev", async (file) => {
    const load =
      'export const ssr = false;\nexport const hydrate = true;\nexport const prerender = true;\nexport const load = () => ({ title: "Hi" });\n';
    const root = await project({
      "src/droplets/card/+droplet.hbs": "{{!-- export hydrate = false --}}\n<p>{{data.title}}</p>\n",
      [`src/droplets/card/${file}`]: load,
      "src/droplets/plain/+droplet.hbs": "<p>{{data.title}}</p>\n",
      [`src/droplets/plain/${file}`]: load,
      "fake-entry.js": fakeEntry,
    });
    const expected = [
      { id: "card", ssr: true, hydrate: false, prerender: false },
      { id: "plain", ssr: true, hydrate: true, prerender: false },
    ];
    const server = await createServer(config(root));
    try {
      expect(api(server.config.plugins).droplets()).toMatchObject(expected);
    } finally {
      await server.close();
    }
    const builder = await createBuilder(buildConfig(root));
    expect(api(builder.config.plugins).droplets()).toMatchObject(expected);
    await builder.buildApp();
  });
});

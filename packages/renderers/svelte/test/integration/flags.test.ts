// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type DropletsPluginApi, droplets } from "@dropletsjs/droplets/vite";
import { createBuilder, createServer, type InlineConfig, type Plugin } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { svelte } from "../../src/index.ts";

type ProjectInput = { files: Record<string, string> };

type ConfigInput = { root: string };

type ApiInput = { plugins: readonly Plugin[] };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project({ files }: ProjectInput): Promise<string> {
  // Under the package, so a build resolves svelte from its node_modules.
  const root = await mkdtemp(fileURLToPath(new URL("../fixtures/.flags-", import.meta.url)));
  roots.push(root);
  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), content);
    }),
  );
  return root;
}

const fakeEntry = 'import manifest from "virtual:droplets-manifest";\nexport default manifest;\n';

const config = ({ root }: ConfigInput): InlineConfig => ({
  root,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true, hmr: false, watch: null },
  plugins: [droplets({ renderers: [svelte()] })],
});

const buildConfig = ({ root }: ConfigInput): InlineConfig => ({
  ...config({ root }),
  plugins: [
    droplets({
      adapter: { name: "fake", serverEntry: join(root, "fake-entry.js"), serverFile: "server.js", separateSsrBundle: true },
      renderers: [svelte()],
    }),
  ],
});

const api = ({ plugins }: ApiInput): DropletsPluginApi => plugins.find((plugin) => plugin.name === "droplets")?.api as DropletsPluginApi;

describe("flags of a Svelte droplet", () => {
  it("come from <script module>, where a commented-out one does not count", async () => {
    const root = await project({
      files: {
        "src/droplets/card/+droplet.svelte": [
          `<script module lang="ts">`,
          "  // export const ssr = false",
          "  export const hydrate = false;",
          "</script>",
          "<p>card</p>",
        ].join("\n"),
      },
    });
    const server = await createServer(config({ root }));
    try {
      expect(api({ plugins: server.config.plugins }).droplets()).toMatchObject([{ id: "card", ssr: true, hydrate: false }]);
    } finally {
      await server.close();
    }
  });

  it.each(["+droplet.ts", "+droplet.server.ts"])("are ignored in %s, in a build and in vite dev", async (file) => {
    const load =
      "export const ssr = false;\nexport const hydrate = true;\nexport const prerender = true;\nexport const load = () => ({});\n";
    const root = await project({
      files: {
        "src/droplets/card/+droplet.svelte": "<script module>export const hydrate = false;</script>\n<p>card</p>\n",
        [`src/droplets/card/${file}`]: load,
        "src/droplets/plain/+droplet.svelte": "<p>plain</p>\n",
        [`src/droplets/plain/${file}`]: load,
        "fake-entry.js": fakeEntry,
      },
    });
    const expected = [
      { id: "card", ssr: true, hydrate: false, prerender: false },
      { id: "plain", ssr: true, hydrate: true, prerender: false },
    ];
    const server = await createServer(config({ root }));
    try {
      expect(api({ plugins: server.config.plugins }).droplets()).toMatchObject(expected);
    } finally {
      await server.close();
    }
    const builder = await createBuilder(buildConfig({ root }));
    expect(api({ plugins: builder.config.plugins }).droplets()).toMatchObject(expected);
    await builder.buildApp();
  });
});

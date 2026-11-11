// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createBuilder, createServer, type InlineConfig } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { droplets, type DropletsPluginApi } from "@dropletsjs/droplets/vite";
import { svelte } from "../src/index.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "droplets-svelte-flags-"));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
  }
  return root;
}

const config = (root: string): InlineConfig => ({
  root,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true, hmr: false, watch: null },
  plugins: [droplets({ renderers: [svelte()] })],
});

describe("flags of a Svelte droplet", () => {
  it("come from <script module>, where a commented-out one does not count", async () => {
    const root = await project({
      "src/droplets/card/+droplet.svelte": [
        `<script module lang="ts">`,
        "  // export const ssr = false",
        "  export const hydrate = false;",
        "</script>",
        "<p>card</p>",
      ].join("\n"),
    });
    const server = await createServer(config(root));
    try {
      const api = server.config.plugins.find((plugin) => plugin.name === "droplets")?.api as DropletsPluginApi;
      expect(api.droplets()).toMatchObject([{ id: "card", ssr: true, hydrate: false }]);
    } finally {
      await server.close();
    }
  });

  it.each(["+droplet.ts", "+droplet.server.ts"])("fail the build and vite dev when %s exports one", async (file) => {
    const root = await project({
      "src/droplets/card/+droplet.svelte": "<p>card</p>\n",
      [`src/droplets/card/${file}`]: "export const ssr = false;\nexport const load = () => ({});\n",
    });
    const message = `droplets: card/${file} exports "ssr": flags live only in the droplet's component; ` +
      "declare it in card/+droplet.svelte";
    await expect(createServer(config(root))).rejects.toThrow(message);
    await expect(createBuilder(config(root))).rejects.toThrow(message);
  });
});

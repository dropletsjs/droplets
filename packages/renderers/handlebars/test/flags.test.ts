// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createBuilder, createServer, type InlineConfig } from "vite";
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

const config = (root: string): InlineConfig => ({
  root,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true, hmr: false, watch: null },
  plugins: [droplets({ renderers: [handlebars()] })],
});

describe("flags of a Handlebars droplet", () => {
  it("come from the comment the template opens with", async () => {
    const root = await project({
      "src/droplets/card/+droplet.hbs": "{{!-- export hydrate = false; export prerender = true --}}\n<p>{{data.title}}</p>\n",
      "src/droplets/card/+droplet.ts": "export const load = () => ({ title: \"Hi\" });\n",
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
      "src/droplets/card/+droplet.hbs": "<p>{{data.title}}</p>\n",
      [`src/droplets/card/${file}`]: "export const hydrate = false;\nexport const load = () => ({ title: \"Hi\" });\n",
    });
    const message = `droplets: card/${file} exports "hydrate": flags live only in the droplet's component; ` +
      "declare it in card/+droplet.hbs";
    await expect(createServer(config(root))).rejects.toThrow(message);
    await expect(createBuilder(config(root))).rejects.toThrow(message);
  });
});

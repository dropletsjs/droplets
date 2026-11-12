import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveConfig } from "@dropletsjs/droplets";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { node } from "../src/index.ts";
import { buildFixture, FIXTURE_ROOT } from "./build-fixture.ts";

const outDir = resolve(FIXTURE_ROOT, "dist-node-index");

type Server = { default: { fetch(request: Request): Promise<Response> } };

/** A function-form config: the element tells which env it was called with, and `cors.origin` is a function the bundle must keep. */
const FUNCTION_CONFIGS = {
  sync: `export default ({ command, mode, isPreview }) => ({
  element: command === "build" && mode === "production" && !isPreview ? "test-droplet" : "wrong-env",
  cors: { origin: (origin) => origin },
  server: { port: 8127 },
});
`,
  async: `export default async ({ command, mode, isPreview }) => {
  await new Promise((wake) => setTimeout(wake, 5));
  return {
    element: command === "build" && mode === "production" && !isPreview ? "test-droplet" : "wrong-env",
    cors: { origin: (origin) => origin },
    server: { port: 8128 },
  };
};
`,
} as const;

describe("node", () => {
  beforeAll(async () => {
    await buildFixture({ outDir });
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("emits server.js next to the SSR bundle, with only node: imports left", async () => {
    expect(existsSync(resolve(outDir, "server.js"))).toBe(true);
    expect(existsSync(resolve(outDir, "server/entry-server.js"))).toBe(true);
    const server = await readFile(resolve(outDir, "server.js"), "utf8");
    const bare = [...server.matchAll(/^import .* from "([^"]+)";?$/gm)].map((m) => m[1]);
    expect(bare.every((spec) => spec?.startsWith("node:"))).toBe(true);
    // The user's config is baked in, so no droplets.config.ts is read at runtime.
    expect(server).toContain("8123");
  });

  it("previews the build the same way", async () => {
    const { preview } = node();
    if (!preview) throw new Error("node() has no preview");
    const app = await preview({ root: FIXTURE_ROOT, outDir, config: resolveConfig({ element: "test-droplet" }) });
    const res = await app.fetch(new Request("http://drops.test/droplets/hello?who=Preview"));
    expect(await res.text()).toContain("Hello Preview!");
  });
});

describe("node with a function-form droplets.config.ts", () => {
  for (const [form, source] of Object.entries(FUNCTION_CONFIGS)) {
    describe(form, () => {
      const dir = resolve(FIXTURE_ROOT, `dist-node-config-${form}`);
      const configFile = resolve(FIXTURE_ROOT, `droplets.${form}.config.ts`);
      let server: Server;

      beforeAll(async () => {
        await writeFile(configFile, source);
        try {
          await buildFixture({ outDir: dir, configFile });
        } finally {
          await rm(configFile, { force: true });
        }
        server = (await import(pathToFileURL(resolve(dir, "server.js")).href)) as Server;
      });

      afterAll(async () => {
        await rm(dir, { recursive: true, force: true });
      });

      it("calls it in the server with the build's config env and keeps the functions inside the config", async () => {
        const bundle = await readFile(resolve(dir, "server.js"), "utf8");
        expect(bundle).toMatch(/"command":\s*"build"/);
        expect(bundle).toMatch(/"mode":\s*"production"/);
        const fragment = await server.default.fetch(
          new Request("http://drops.test/droplets/hello?who=Config", { headers: { origin: "http://other.test" } }),
        );
        expect(fragment.status).toBe(200);
        expect((await fragment.text()).startsWith('<test-droplet data-droplet="hello"')).toBe(true);
        expect(fragment.headers.get("access-control-allow-origin")).toBe("http://other.test");
      });
    });
  }
});

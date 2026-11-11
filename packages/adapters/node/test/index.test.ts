import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveConfig } from "@dropletsjs/droplets";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { node } from "../src/index.ts";
import { buildFixture, FIXTURE_ROOT } from "./build-fixture.ts";

const outDir = resolve(FIXTURE_ROOT, "dist-node-index");

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

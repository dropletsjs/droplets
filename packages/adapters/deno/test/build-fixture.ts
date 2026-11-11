import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeRenderer } from "@dropletsjs/droplets/testing";
import { droplets } from "@dropletsjs/droplets/vite";
import { createBuilder } from "vite";
import { deno } from "../src/index.ts";

// The framework's own fixture (fake renderer, see @dropletsjs/droplets/testing), element "test-droplet".
export const FIXTURE_ROOT = fileURLToPath(new URL("../../../droplets/test/fixtures/app/", import.meta.url));

export type BuildFixtureInput = { outDir: string };

/** Builds the fixture with `deno()` into `outDir`, emptied first. */
export async function buildFixture({ outDir }: BuildFixtureInput): Promise<void> {
  if (!existsSync(resolve(FIXTURE_ROOT, "../../../dist/vite.js"))) {
    throw new Error("Build @dropletsjs/droplets first (pnpm build at the root).");
  }
  await rm(outDir, { recursive: true, force: true });
  const builder = await createBuilder({
    root: FIXTURE_ROOT,
    configFile: false,
    logLevel: "silent",
    build: { outDir },
    plugins: [droplets({ adapter: deno(), renderers: [fakeRenderer()], css: { tailwind: true } })],
  });
  await builder.buildApp();
}

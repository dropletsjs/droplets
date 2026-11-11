import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fakeRenderer } from "@dropletsjs/droplets/testing";
import { droplets } from "@dropletsjs/droplets/vite";
import { createBuilder } from "vite";
import type { NodeServerPaths } from "../src/app.ts";
import { node } from "../src/index.ts";

// The framework's own fixture (fake renderer, see @dropletsjs/droplets/testing), element "test-droplet".
export const FIXTURE_ROOT = fileURLToPath(new URL("../../../droplets/test/fixtures/app/", import.meta.url));

export type BuildFixtureInput = { outDir: string };

/** Builds the fixture with `node()` into `outDir`, emptied first; the paths `createNodeServerApp` takes. */
export async function buildFixture({ outDir }: BuildFixtureInput): Promise<NodeServerPaths> {
  if (!existsSync(resolve(FIXTURE_ROOT, "../../../dist/vite.js"))) {
    throw new Error("Build @dropletsjs/droplets first (pnpm build at the root).");
  }
  await rm(outDir, { recursive: true, force: true });
  const builder = await createBuilder({
    root: FIXTURE_ROOT,
    configFile: false,
    logLevel: "silent",
    build: { outDir },
    plugins: [droplets({ adapter: node(), renderers: [fakeRenderer()], css: { tailwind: true } })],
  });
  await builder.buildApp();
  return {
    clientRoot: resolve(outDir, "client"),
    ssrEntryUrl: pathToFileURL(resolve(outDir, "server/entry-server.js")).href,
  };
}

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fakeRenderer } from "@dropletsjs/droplets/testing";
import { droplets, type DropletsCssOptions } from "@dropletsjs/droplets/vite";
import { buildFixtureApp } from "@dropletsjs/shared/vitest";
import type { NodeServerPaths } from "../src/app.ts";
import { node } from "../src/index.ts";

export { FIXTURE_ROOT } from "@dropletsjs/shared/vitest";

export type BuildFixtureInput = { outDir: string; css?: DropletsCssOptions; configFile?: string };

/** Builds the fixture with `node()` into `outDir`, emptied first; the paths `createNodeServerApp` takes. */
export async function buildFixture({ outDir, css = { tailwind: true }, configFile }: BuildFixtureInput): Promise<NodeServerPaths> {
  await buildFixtureApp({
    outDir,
    plugins: [droplets({ adapter: node(), renderers: [fakeRenderer()], css, ...(configFile ? { configFile } : {}) })],
  });
  return {
    clientRoot: resolve(outDir, "client"),
    ssrEntryUrl: pathToFileURL(resolve(outDir, "server/entry-server.js")).href,
  };
}

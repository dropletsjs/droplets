import { fakeRenderer } from "@dropletsjs/droplets/testing";
import { droplets, type DropletsCssOptions } from "@dropletsjs/droplets/vite";
import { buildFixtureApp } from "@dropletsjs/shared/vitest";
import { cloudflare } from "../src/index.ts";

export { FIXTURE_ROOT } from "@dropletsjs/shared/vitest";

export type BuildFixtureInput = { outDir: string; css?: DropletsCssOptions; configFile?: string };

/** Builds the fixture with `cloudflare()` into `outDir`, emptied first. */
export function buildFixture({ outDir, css = { tailwind: true }, configFile }: BuildFixtureInput): Promise<void> {
  const plugin = droplets({ adapter: cloudflare(), renderers: [fakeRenderer()], css, ...(configFile ? { configFile } : {}) });
  return buildFixtureApp({ outDir, plugins: [plugin] });
}

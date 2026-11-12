import { fakeRenderer } from "@dropletsjs/droplets/testing";
import { droplets } from "@dropletsjs/droplets/vite";
import { buildFixtureApp } from "@dropletsjs/shared/vitest";
import { deno } from "../src/index.ts";

export { FIXTURE_ROOT } from "@dropletsjs/shared/vitest";

export type BuildFixtureInput = { outDir: string };

/** Builds the fixture with `deno()` into `outDir`, emptied first. */
export function buildFixture({ outDir }: BuildFixtureInput): Promise<void> {
  return buildFixtureApp({ outDir, plugins: [droplets({ adapter: deno(), renderers: [fakeRenderer()], css: { tailwind: true } })] });
}

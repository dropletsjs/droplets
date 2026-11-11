import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "@dropletsjs/droplets";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloudflare } from "../src/index.ts";

/** `run_worker_first` in the user's own wrangler config: read, never written. */
describe("cloudflare adapter: run_worker_first", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-wrangler-"));
    await mkdir(join(root, "dist/client"), { recursive: true });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  const afterBuild = () =>
    cloudflare().afterBuild!({ root, outDir: join(root, "dist"), serverPath: "dist/worker.js" } as never);

  it("builds when it is true, in wrangler.jsonc (comments, trailing commas) and wrangler.toml", async () => {
    await writeFile(
      join(root, "wrangler.jsonc"),
      '{\n  // the Worker answers first\n  "main": "dist/worker.js",\n  "assets": { "directory": "dist/client", "run_worker_first": true, },\n}\n',
    );
    await expect(afterBuild()).resolves.toBeUndefined();
    await rm(join(root, "wrangler.jsonc"));
    await writeFile(join(root, "wrangler.toml"), 'main = "dist/worker.js"\n\n[assets]\ndirectory = "dist/client"\nrun_worker_first = true # always\n');
    await expect(afterBuild()).resolves.toBeUndefined();
  });

  it("stops the build when it is false, unset or a list of paths", async () => {
    for (const assets of ['{ "run_worker_first": false }', '{ "directory": "dist/client" }', '{ "run_worker_first": ["/index.js", "/droplets/*"] }']) {
      await writeFile(join(root, "wrangler.json"), `{ "assets": ${assets} }`);
      await expect(afterBuild(), assets).rejects.toThrow(/wrangler\.json: assets\.run_worker_first is .+; set "assets": \{ "run_worker_first": true \}/);
    }
    await rm(join(root, "wrangler.json"));
    await writeFile(join(root, "wrangler.toml"), '[assets]\ndirectory = "dist/client"\nrun_worker_first = false\n');
    await expect(afterBuild()).rejects.toThrow("wrangler.toml: assets.run_worker_first is false");
  });

  it("warns when the config does not parse, and says what to set without one", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    await afterBuild();
    expect(String(info.mock.calls[0]?.[1])).toContain('"assets.run_worker_first": true');
    await writeFile(join(root, "wrangler.jsonc"), "{ not json");
    await afterBuild();
    expect(String(warn.mock.calls[0]?.[1])).toContain("could not read assets.run_worker_first in wrangler.jsonc; it must be true");
  });
});

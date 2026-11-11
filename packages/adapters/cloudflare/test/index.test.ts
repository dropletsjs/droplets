import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { logger } from "@dropletsjs/droplets";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cloudflare } from "../src/index.ts";
import { buildFixture, FIXTURE_ROOT } from "./build-fixture.ts";

describe("cloudflare", () => {
  const outDir = resolve(FIXTURE_ROOT, "dist-cloudflare-index");

  beforeAll(async () => {
    await buildFixture({ outDir });
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("emits one self-contained worker.js and no separate SSR bundle", async () => {
    expect(existsSync(resolve(outDir, "worker.js"))).toBe(true);
    expect(existsSync(resolve(outDir, "server.js"))).toBe(false);
    expect(existsSync(resolve(outDir, "server/entry-server.js"))).toBe(false);
    const source = await readFile(resolve(outDir, "worker.js"), "utf8");
    expect(source).not.toMatch(/^import /m);
    // Nothing from Node may be imported by core or the fake renderer. (An
    // engine may add some: Svelte's server renderer lazily imports
    // node:async_hooks, which Workers provide under nodejs_compat. Core asks
    // for it through process.getBuiltinModule, which is not an import.)
    const nodeModules = new Set(
      [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']node:([a-z_/]+)["']/g)].map((m) => m[1]),
    );
    expect([...nodeModules].sort()).toEqual([]);
    // The manifest and the config are baked in.
    expect(source).toContain("__entryClient");
    expect(source).toContain("test-droplet");
  });

  it("writes .assetsignore, so the manifest and Vite's are never uploaded", async () => {
    expect(await readFile(resolve(outDir, "client/.assetsignore"), "utf8")).toBe("/droplets.json\n/.vite/\n");
  });
});

/** `run_worker_first` in the user's own wrangler config: read, never written. */
describe("cloudflare: run_worker_first", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-wrangler-"));
    await mkdir(join(root, "dist/client"), { recursive: true });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  const afterBuild = () => {
    const adapter = cloudflare();
    if (adapter.afterBuild === undefined) expect.unreachable("cloudflare().afterBuild");
    return adapter.afterBuild({
      root,
      outDir: join(root, "dist"),
      manifestPath: join(root, "dist/client/droplets.json"),
      serverPath: "dist/worker.js",
    });
  };

  it("accepts true, in wrangler.jsonc (comments, trailing commas) and wrangler.toml, and a list that covers the Worker's routes", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    await writeFile(
      join(root, "wrangler.jsonc"),
      '{\n  // the Worker answers first\n  "main": "dist/worker.js",\n  "assets": { "directory": "dist/client", "run_worker_first": true, },\n}\n',
    );
    await expect(afterBuild()).resolves.toBeUndefined();
    await rm(join(root, "wrangler.jsonc"));
    for (const list of ['["/index.js", "/droplets/*", "/assets/*"]', '["/*"]', '["/assets/*", "/index.js", "/droplets/*", "!/health"]']) {
      await writeFile(join(root, "wrangler.json"), `{ "assets": { "run_worker_first": ${list} } }`);
      await afterBuild();
    }
    await rm(join(root, "wrangler.json"));
    await writeFile(
      join(root, "wrangler.toml"),
      'main = "dist/worker.js"\n\n[assets]\ndirectory = "dist/client"\nrun_worker_first = true # always\n',
    );
    await afterBuild();
    await writeFile(join(root, "wrangler.toml"), '[assets]\nrun_worker_first = ["/*"]\n');
    await afterBuild();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once, never fails, when it is false, unset or a list that misses one of the Worker's routes", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const values = [
      "false",
      undefined,
      '["/index.js", "/droplets/*"]',
      '["/index.js", "/droplets/*/client.js", "/assets/*"]',
      '["/*", "!/assets/public/*"]',
      '["/*", "!/index.js"]',
    ];
    for (const value of values) {
      warn.mockClear();
      const assets = value === undefined ? '{ "directory": "dist/client" }' : `{ "run_worker_first": ${value} }`;
      await writeFile(join(root, "wrangler.json"), `{ "assets": ${assets} }`);
      await expect(afterBuild(), assets).resolves.toBeUndefined();
      expect(warn, assets).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[1]);
      expect(message).toContain(
        `wrangler.json: assets.run_worker_first is ${value === undefined ? "not set" : JSON.stringify(JSON.parse(value))}`,
      );
      expect(message).toContain("without the Worker's CORS and no-store headers");
      expect(message).toContain("https://dropletsjs.dev/guides/deployment/#run_worker_first");
    }
    await rm(join(root, "wrangler.json"));
    warn.mockClear();
    await writeFile(join(root, "wrangler.toml"), '[assets]\ndirectory = "dist/client"\nrun_worker_first = false\n');
    await expect(afterBuild()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[1])).toContain("wrangler.toml: assets.run_worker_first is false");
  });

  it("warns when the config does not parse, and says what to set without one", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    await afterBuild();
    expect(String(info.mock.calls[0]?.[1])).toContain('"assets.run_worker_first": true');
    await writeFile(join(root, "wrangler.jsonc"), "{ not json");
    await afterBuild();
    expect(String(warn.mock.calls[0]?.[1])).toContain("could not read assets.run_worker_first in wrangler.jsonc; set it to true");
  });
});

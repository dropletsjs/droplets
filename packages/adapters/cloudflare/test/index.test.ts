import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { logger, resolveConfig } from "@dropletsjs/droplets";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
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

  it("writes _headers next to the build's files", async () => {
    expect(await readFile(resolve(outDir, "client/_headers"), "utf8")).toBe(DEFAULT_HEADERS);
  });
});

const IMMUTABLE = "public, max-age=2592000, immutable";

/** What the adapter writes first in `dist/client/_headers`, for a `/assets/public/*` rule. */
function adapterHeaders(publicRule: string): string {
  const files = (path: string, cacheControl: string) =>
    `${path}\n  Access-Control-Allow-Origin: *\n  ! Cache-Control\n  Cache-Control: ${cacheControl}\n`;
  return (
    files("/index.js", "no-store") +
    files("/assets/*", IMMUTABLE) +
    publicRule +
    files("/droplets/:id/client.js", IMMUTABLE) +
    files("/droplets/:id/style.css", IMMUTABLE)
  );
}

const DEFAULT_HEADERS = adapterHeaders("/assets/public/*\n  ! Cache-Control\n  Cache-Control: no-cache\n");

describe("cloudflare: afterBuild", () => {
  let root: string;
  let warn: MockInstance<typeof logger.warn>;
  let info: MockInstance<typeof logger.info>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-wrangler-"));
    await mkdir(join(root, "dist/client"), { recursive: true });
    warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    info = vi.spyOn(logger, "info").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  type AfterBuildInput = { config?: Parameters<typeof resolveConfig>[0] };

  const afterBuild = ({ config = {} }: AfterBuildInput = {}) => {
    const adapter = cloudflare();
    if (adapter.afterBuild === undefined) expect.unreachable("cloudflare().afterBuild");
    return adapter.afterBuild({
      root,
      outDir: join(root, "dist"),
      manifestPath: join(root, "dist/client/droplets.json"),
      serverPath: "dist/worker.js",
      config: resolveConfig(config),
    });
  };
  const headers = () => readFile(join(root, "dist/client/_headers"), "utf8");
  const messages = () => warn.mock.calls.map((call) => String(call[1]));

  describe("_headers", () => {
    it("gives the build's files their CORS and Cache-Control, publicCacheControl on /assets/public/*", async () => {
      await afterBuild();
      expect(await headers()).toBe(DEFAULT_HEADERS);
      await afterBuild({ config: { publicCacheControl: "public, max-age=3600" } });
      expect(await headers()).toBe(adapterHeaders("/assets/public/*\n  ! Cache-Control\n  Cache-Control: public, max-age=3600\n"));
      await afterBuild({ config: { publicCacheControl: false } });
      expect(await headers()).toBe(adapterHeaders("/assets/public/*\n  ! Cache-Control\n"));
      expect(warn).not.toHaveBeenCalled();
    });

    it("appends the project's own _headers after the adapter's rules", async () => {
      const own = "/assets/public/fonts/*\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000\n";
      await writeFile(join(root, "_headers"), own);
      await afterBuild();
      expect(await headers()).toBe(`${DEFAULT_HEADERS}\n${own}`);
    });

    it("warns once when public/_headers lands at /assets/public/_headers, where Cloudflare never reads it", async () => {
      await mkdir(join(root, "dist/client/assets/public"), { recursive: true });
      await writeFile(join(root, "dist/client/assets/public/_headers"), "/*\n  X-Test: 1\n");
      await afterBuild();
      expect(messages()).toEqual([
        expect.stringContaining("public/_headers lands at /assets/public/_headers, where Cloudflare never reads it"),
      ]);
      expect(messages()[0]).toContain("https://dropletsjs.dev/guides/deployment/#_headers");
    });

    it("warns, never fails, over Cloudflare's limits: 100 rules, 2,000 characters a line", async () => {
      await writeFile(join(root, "_headers"), Array.from({ length: 95 }, (_, i) => `/r${i}\n  X-Rule: ${i}\n`).join(""));
      await expect(afterBuild()).resolves.toBeUndefined();
      expect(messages()).toEqual([]);
      await writeFile(join(root, "_headers"), Array.from({ length: 96 }, (_, i) => `/r${i}\n  X-Rule: ${i}\n`).join(""));
      await expect(afterBuild()).resolves.toBeUndefined();
      expect(messages()).toEqual([expect.stringContaining("dist/client/_headers has 101 rules: Cloudflare takes up to 100 rules")]);
      warn.mockClear();
      await writeFile(join(root, "_headers"), `/long\n  X-Long: ${"a".repeat(2000)}\n`);
      await afterBuild();
      expect(messages()).toEqual([expect.stringContaining("dist/client/_headers has 1 line over 2000 characters")]);
    });
  });

  describe("run_worker_first", () => {
    const WARNING = "go through the Worker, billed per request; dist/client/_headers already gives them their CORS and cache headers";

    it("stays silent when it is unset, false, or a list that leaves the build's files to static assets", async () => {
      for (const assets of [
        '{ "directory": "dist/client" }',
        '{ "run_worker_first": false }',
        '{ "run_worker_first": ["/api/*"] }',
        '{ "run_worker_first": ["/*", "!/index.js", "!/assets/*", "!/droplets/*"] }',
      ]) {
        await writeFile(join(root, "wrangler.json"), `{ "assets": ${assets} }`);
        await expect(afterBuild(), assets).resolves.toBeUndefined();
      }
      await rm(join(root, "wrangler.json"));
      await writeFile(join(root, "wrangler.toml"), '[assets]\ndirectory = "dist/client"\nrun_worker_first = false\n');
      await afterBuild();
      expect(warn).not.toHaveBeenCalled();
    });

    it("warns once, never fails, when it sends a build file through the Worker", async () => {
      const cases = [
        [
          "wrangler.jsonc",
          '{\n  // all of it\n  "assets": { "directory": "dist/client", "run_worker_first": true, },\n}\n',
          "true",
          "/index.js",
        ],
        ["wrangler.json", '{ "assets": { "run_worker_first": ["/*"] } }', '["/*"]', "/index.js"],
        [
          "wrangler.json",
          '{ "assets": { "run_worker_first": ["/droplets/*/client.js"] } }',
          '["/droplets/*/client.js"]',
          "/droplets/x/client.js",
        ],
        ["wrangler.json", '{ "assets": { "run_worker_first": ["/*", "!/index.js"] } }', '["/*","!/index.js"]', "/assets/index.js"],
        ["wrangler.toml", '[assets]\ndirectory = "dist/client"\nrun_worker_first = true # always\n', "true", "/index.js"],
      ] as const;
      for (const [file, text, value, path] of cases) {
        warn.mockClear();
        await writeFile(join(root, file), text);
        await expect(afterBuild(), text).resolves.toBeUndefined();
        await rm(join(root, file));
        expect(messages(), text).toHaveLength(1);
        expect(messages()[0], text).toContain(`${file}: assets.run_worker_first is ${value}, so build files (${path}`);
        expect(messages()[0], text).toContain(WARNING);
        expect(messages()[0], text).toContain("https://dropletsjs.dev/guides/deployment/#run_worker_first");
      }
    });

    it("matches the build's own files from the manifest", async () => {
      await writeFile(
        join(root, "dist/client/droplets.json"),
        JSON.stringify({
          __entryModule: "assets/index-a1.js",
          droplets: { card: { client: "droplets/card/client.js", css: ["assets/card.css"] } },
        }),
      );
      for (const [list, path] of [
        ['["/assets/index-a1.js"]', "/assets/index-a1.js"],
        ['["/droplets/card/client.js"]', "/droplets/card/client.js"],
        ['["/droplets/card/style.css"]', "/droplets/card/style.css"],
      ] as const) {
        warn.mockClear();
        await writeFile(join(root, "wrangler.json"), `{ "assets": { "run_worker_first": ${list} } }`);
        await afterBuild();
        expect(messages(), list).toEqual([expect.stringContaining(`so build files (${path})`)]);
      }
    });

    it("says what to set without a config, and warns when the config does not parse", async () => {
      await afterBuild();
      const said = String(info.mock.calls[0]?.[1]);
      expect(said).toContain('point "main" at dist/worker.js and "assets.directory" at dist/client');
      expect(said).not.toContain("run_worker_first");
      await writeFile(join(root, "wrangler.jsonc"), "{ not json");
      await afterBuild();
      expect(messages()).toEqual([
        expect.stringContaining(
          "could not read assets.run_worker_first in wrangler.jsonc; leave it out so static assets serve the build's files",
        ),
      ]);
    });
  });
});

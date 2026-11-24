import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type FileHeaderRule, resolveConfig } from "@dropletsjs/droplets";
import { logger } from "@dropletsjs/droplets/vite";
import { formatMessage } from "@dropletsjs/droplets/errors";
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

const FILES = { "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" };

type FileTableInput = { publicCacheControl: string | false; prerendered?: string };

const PRERENDERED = "private, no-store, no-transform";

/** The file-header table the plugin passes as `fileHeaders` for `publicCacheControl`, and `prerendered` the prerender files' Cache-Control. */
function fileTable({ publicCacheControl, prerendered = PRERENDERED }: FileTableInput): FileHeaderRule[] {
  return [
    { path: "/index.js", headers: { ...FILES, "Cache-Control": "no-store" } },
    { path: "/index.css", headers: { ...FILES, "Cache-Control": "no-store" } },
    { path: "/assets/*", headers: { ...FILES, "Cache-Control": IMMUTABLE } },
    {
      path: "/assets/public/*",
      headers: { ...FILES, ...(publicCacheControl === false ? {} : { "Cache-Control": publicCacheControl }) },
    },
    { path: "/assets/prerendered/*", headers: { ...FILES, "Cache-Control": prerendered } },
    { path: "/droplets/:id/client.js", headers: { ...FILES, "Cache-Control": IMMUTABLE } },
    { path: "/droplets/:id/style.css", headers: { ...FILES, "Cache-Control": IMMUTABLE } },
  ];
}

/** The `/assets/prerendered/*` rule the adapter writes for the prerender files' Cache-Control. */
const prerenderedRule = (cacheControl: string) => `/assets/prerendered/*\n  ! Cache-Control\n  Cache-Control: ${cacheControl}\n`;

/** What the adapter writes first in `dist/client/_headers`, for a `/assets/public/*` rule and a `/assets/prerendered/*` one. */
function adapterHeaders(publicRule: string, prerendered = prerenderedRule(PRERENDERED)): string {
  const files = (path: string, cacheControl: string) =>
    `${path}\n  Access-Control-Allow-Origin: *\n  X-Content-Type-Options: nosniff\n  ! Cache-Control\n  Cache-Control: ${cacheControl}\n`;
  return (
    files("/index.js", "no-store") +
    files("/index.css", "no-store") +
    files("/assets/*", IMMUTABLE) +
    publicRule +
    prerendered +
    files("/droplets/:id/client.js", IMMUTABLE) +
    files("/droplets/:id/style.css", IMMUTABLE)
  );
}

type CloudflarePatternInput = { pattern: string; path: string };

/** Cloudflare's `_headers` URL match: `:name` one segment, `*` anything. */
function cloudflareMatches({ pattern, path }: CloudflarePatternInput): boolean {
  const source = pattern
    .split(/(:\w+|\*)/)
    .map((part) => (part === "*" ? ".*" : part.startsWith(":") ? "[^/]+" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${source}$`).test(path);
}

type CloudflareHeadersInput = { text: string; path: string };

/**
 * What Cloudflare's static assets send for `path` under a `_headers` text:
 * every matching rule in order, a header joined to one already set, `! Name`
 * detaching it, over the platform's own `Cache-Control`.
 */
function cloudflareHeaders({ text, path }: CloudflareHeadersInput): Headers {
  const headers = new Headers({ "cache-control": "public, max-age=0, must-revalidate" });
  let matches = false;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    if (!/^\s/.test(line)) {
      matches = cloudflareMatches({ pattern: line.trim(), path });
      continue;
    }
    if (!matches) continue;
    const entry = line.trim();
    if (entry.startsWith("! ")) {
      headers.delete(entry.slice(2));
      continue;
    }
    const colon = entry.indexOf(":");
    headers.append(entry.slice(0, colon), entry.slice(colon + 1).trim());
  }
  return headers;
}

const DEFAULT_HEADERS = adapterHeaders("/assets/public/*\n  ! Cache-Control\n  Cache-Control: no-cache\n");

describe("cloudflare: afterBuild", () => {
  let root: string;
  let warn: MockInstance<typeof logger.report>;
  let info: MockInstance<typeof logger.info>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-wrangler-"));
    await mkdir(join(root, "dist/client"), { recursive: true });
    warn = vi.spyOn(logger, "report").mockImplementation(() => {});
    info = vi.spyOn(logger, "info").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  type AfterBuildInput = { config?: Parameters<typeof resolveConfig>[0]; table?: FileHeaderRule[] };

  const afterBuild = ({ config = {}, table }: AfterBuildInput = {}) => {
    const adapter = cloudflare();
    if (adapter.afterBuild === undefined) expect.unreachable("cloudflare().afterBuild");
    const resolved = resolveConfig(config);
    return adapter.afterBuild({
      root,
      outDir: join(root, "dist"),
      manifestPath: join(root, "dist/client/droplets.json"),
      serverPath: "dist/worker.js",
      config: resolved,
      fileHeaders: table ?? fileTable({ publicCacheControl: resolved.publicCacheControl }),
    });
  };
  const headers = () => readFile(join(root, "dist/client/_headers"), "utf8");
  const messages = () => warn.mock.calls.map(([report]) => formatMessage(report));

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

    it("writes the table it is given, so that Cloudflare gives each path the headers of its last matching rule", async () => {
      const table: FileHeaderRule[] = [
        { path: "/index.js", headers: { ...FILES, "Cache-Control": "no-store" } },
        { path: "/assets/*", headers: { ...FILES, "Cache-Control": "one", "X-Kind": "file" } },
        { path: "/assets/public/*", headers: { ...FILES, "Cache-Control": "two" } },
        { path: "/assets/public/img/*", headers: { ...FILES, "X-Kind": "img" } },
        // Under /assets/*, and across /assets/public/* for one directory only.
        { path: "/assets/:dir/x.js", headers: { ...FILES, "X-Kind": "x" } },
        { path: "/droplets/:id/client.js", headers: { ...FILES, "Cache-Control": "three" } },
      ];
      await afterBuild({ table });
      const text = await headers();
      for (const [path, own] of [
        ["/index.js", { "Cache-Control": "no-store" }],
        ["/assets/a.js", { "Cache-Control": "one", "X-Kind": "file" }],
        ["/assets/chunks/a.js", { "Cache-Control": "one", "X-Kind": "file" }],
        ["/assets/public/robots.txt", { "Cache-Control": "two" }],
        ["/assets/public/img/logo.svg", { "X-Kind": "img" }],
        ["/assets/public/x.js", { "X-Kind": "x" }],
        ["/assets/other/x.js", { "X-Kind": "x" }],
        ["/droplets/hello/client.js", { "Cache-Control": "three" }],
      ] as const) {
        expect([...cloudflareHeaders({ text, path })], path).toEqual([...new Headers({ ...FILES, ...own })]);
      }
    });

    it("gives each build file on Cloudflare exactly the headers of the file-header table", async () => {
      for (const publicCacheControl of ["no-cache", "public, max-age=3600", false] as const) {
        await afterBuild({ config: { publicCacheControl } });
        const text = await headers();
        for (const [path, cache] of [
          ["/index.js", "no-store"],
          ["/index.css", "no-store"],
          ["/assets/index.abc.js", IMMUTABLE],
          ["/assets/public/robots.txt", publicCacheControl],
          ["/assets/prerendered/cart/page-2", PRERENDERED],
          ["/droplets/cart/client.js", IMMUTABLE],
          ["/droplets/cart/style.css", IMMUTABLE],
        ] as const) {
          expect([...cloudflareHeaders({ text, path })], `${path} ${publicCacheControl}`).toEqual([
            ...new Headers({ ...FILES, ...(cache === false ? {} : { "Cache-Control": cache }) }),
          ]);
        }
      }
    });

    it("gives /assets/prerendered/* the live fragment's Cache-Control, its CORS and nosniff once, from /assets/*", async () => {
      for (const [fragmentCacheControl, cache] of [
        [undefined, PRERENDERED],
        ["public, max-age=60", "public, max-age=60, no-transform"],
        [false, "no-transform"],
      ] as const) {
        const config = fragmentCacheControl === undefined ? {} : { fragmentCacheControl };
        const resolved = resolveConfig(config);
        await afterBuild({ config, table: fileTable({ publicCacheControl: resolved.publicCacheControl, prerendered: cache }) });
        const text = await headers();
        expect(text).toBe(adapterHeaders("/assets/public/*\n  ! Cache-Control\n  Cache-Control: no-cache\n", prerenderedRule(cache)));
        expect([...cloudflareHeaders({ text, path: "/assets/prerendered/testimonials/page-2" })]).toEqual([
          ...new Headers({ ...FILES, "Cache-Control": cache }),
        ]);
      }
    });

    it("lets the project's own _headers give the prerender files another Cache-Control, starting with ! Cache-Control", async () => {
      await writeFile(join(root, "_headers"), "/assets/prerendered/*\n  ! Cache-Control\n  Cache-Control: public, max-age=300\n");
      await afterBuild();
      expect([...cloudflareHeaders({ text: await headers(), path: "/assets/prerendered/testimonials/page-2" })]).toEqual([
        ...new Headers({ ...FILES, "Cache-Control": "public, max-age=300" }),
      ]);
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
      expect(messages()[0]).toContain("droplets warning cloudflare-public-headers-ignored");
    });

    it("warns, never fails, over Cloudflare's limits: 100 rules, 2,000 characters a line", async () => {
      // The adapter's own seven rules count.
      await writeFile(join(root, "_headers"), Array.from({ length: 93 }, (_, i) => `/r${i}\n  X-Rule: ${i}\n`).join(""));
      await expect(afterBuild()).resolves.toBeUndefined();
      expect(messages()).toEqual([]);
      await writeFile(join(root, "_headers"), Array.from({ length: 94 }, (_, i) => `/r${i}\n  X-Rule: ${i}\n`).join(""));
      await expect(afterBuild()).resolves.toBeUndefined();
      expect(messages()).toEqual([expect.stringContaining("dist/client/_headers has 101 rules: Cloudflare takes up to 100 rules")]);
      warn.mockClear();
      await writeFile(join(root, "_headers"), `/long\n  X-Long: ${"a".repeat(2000)}\n`);
      await afterBuild();
      expect(messages()).toEqual([expect.stringContaining("dist/client/_headers has 1 line over 2000 characters")]);
    });
  });

  describe("run_worker_first", () => {
    const WARNING =
      "go through the Worker, billed per request\n  fix: leave run_worker_first out: dist/client/_headers already gives the build files their CORS and cache headers";

    it("stays silent when it is unset, false, or a list that leaves the build's files to static assets", async () => {
      for (const assets of [
        '{ "directory": "dist/client" }',
        '{ "run_worker_first": false }',
        '{ "run_worker_first": ["/api/*"] }',
        '{ "run_worker_first": ["/*", "!/index.js", "!/index.css", "!/assets/*", "!/droplets/*"] }',
      ]) {
        await writeFile(join(root, "wrangler.json"), `{ "compatibility_flags": ["nodejs_compat"], "assets": ${assets} }`);
        await expect(afterBuild(), assets).resolves.toBeUndefined();
      }
      await rm(join(root, "wrangler.json"));
      await writeFile(
        join(root, "wrangler.toml"),
        'compatibility_flags = ["nodejs_compat"]\n[assets]\ndirectory = "dist/client"\nrun_worker_first = false\n',
      );
      await afterBuild();
      expect(warn).not.toHaveBeenCalled();
    });

    it("warns once, never fails, when it sends a build file through the Worker", async () => {
      const FLAGS = '"compatibility_flags": ["nodejs_compat"], ';
      const cases = [
        [
          "wrangler.jsonc",
          `{\n  // all of it\n  ${FLAGS}"assets": { "directory": "dist/client", "run_worker_first": true, },\n}\n`,
          "true",
          "/index.js",
        ],
        ["wrangler.json", `{ ${FLAGS}"assets": { "run_worker_first": ["/*"] } }`, '["/*"]', "/index.js"],
        [
          "wrangler.json",
          `{ ${FLAGS}"assets": { "run_worker_first": ["/droplets/*/client.js"] } }`,
          '["/droplets/*/client.js"]',
          "/droplets/x/client.js",
        ],
        [
          "wrangler.json",
          `{ ${FLAGS}"assets": { "run_worker_first": ["/*", "!/index.js"] } }`,
          '["/*","!/index.js"]',
          "/index.css, /assets/index.js",
        ],
        [
          "wrangler.toml",
          'compatibility_flags = ["nodejs_compat"]\n[assets]\ndirectory = "dist/client"\nrun_worker_first = true # always\n',
          "true",
          "/index.js",
        ],
      ] as const;
      for (const [file, text, value, path] of cases) {
        warn.mockClear();
        await writeFile(join(root, file), text);
        await expect(afterBuild(), text).resolves.toBeUndefined();
        await rm(join(root, file));
        expect(messages(), text).toHaveLength(1);
        expect(messages()[0], text).toContain(`file: ${file}\n  what: assets.run_worker_first is ${value}, so build files (${path}`);
        expect(messages()[0], text).toContain(WARNING);
        expect(messages()[0], text).toContain("droplets warning cloudflare-run-worker-first");
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
        ['["/assets/prerendered/*"]', "/assets/prerendered/x/y"],
      ] as const) {
        warn.mockClear();
        await writeFile(
          join(root, "wrangler.json"),
          `{ "compatibility_flags": ["nodejs_compat"], "assets": { "run_worker_first": ${list} } }`,
        );
        await afterBuild();
        expect(messages(), list).toEqual([expect.stringContaining(`so build files (${path})`)]);
      }
    });

    it("says what to set without a config, and warns when the config does not parse", async () => {
      await afterBuild();
      const said = String(info.mock.calls[0]?.[0]);
      expect(said).toContain('point "main" at dist/worker.js and "assets.directory" at dist/client');
      expect(said).not.toContain("run_worker_first");
      await writeFile(join(root, "wrangler.jsonc"), "{ not json");
      await afterBuild();
      expect(messages()).toEqual([
        expect.stringContaining(
          "file: wrangler.jsonc\n  what: could not read the wrangler config (assets.run_worker_first, compatibility_flags)\n  fix: leave run_worker_first out so static assets serve the build's files",
        ),
      ]);
    });
  });

  describe("html_handling", () => {
    const FLAGS = '"compatibility_flags": ["nodejs_compat"], ';

    it("warns once when it keeps the extensionless URL of the prerender files from being served, and only with files", async () => {
      const cases = [
        ["none", "answers 404 (only <file>.html is served)"],
        ["force-trailing-slash", "redirects to /assets/prerendered/<id>/<file>/"],
      ] as const;
      for (const [value, said] of cases) {
        await writeFile(join(root, "wrangler.json"), `{ ${FLAGS}"assets": { "html_handling": "${value}" } }`);
        warn.mockClear();
        await afterBuild();
        expect(messages(), value).toEqual([]);
        await mkdir(join(root, "dist/client/assets/prerendered/testimonials"), { recursive: true });
        await afterBuild();
        expect(messages(), value).toEqual([
          expect.stringContaining(
            `file: wrangler.json\n  what: assets.html_handling is "${value}", so /assets/prerendered/<id>/<file> ${said}\n  fix: leave html_handling out`,
          ),
        ]);
        await rm(join(root, "dist/client/assets/prerendered"), { recursive: true });
      }
      await writeFile(join(root, "wrangler.toml"), 'compatibility_flags = ["nodejs_compat"]\n[assets]\nhtml_handling = "none"\n');
      await rm(join(root, "wrangler.json"));
      await mkdir(join(root, "dist/client/assets/prerendered/testimonials"), { recursive: true });
      warn.mockClear();
      await afterBuild();
      expect(messages()).toEqual([expect.stringContaining('file: wrangler.toml\n  what: assets.html_handling is "none"')]);
    });

    it("stays silent with the default, or the other values that serve <file> from <file>.html", async () => {
      await mkdir(join(root, "dist/client/assets/prerendered/testimonials"), { recursive: true });
      for (const assets of ["{}", '{ "html_handling": "auto-trailing-slash" }', '{ "html_handling": "drop-trailing-slash" }']) {
        await writeFile(join(root, "wrangler.json"), `{ ${FLAGS}"assets": ${assets} }`);
        await afterBuild();
      }
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("nodejs_compat", () => {
    const WARNING = 'compatibility_flags has no "nodejs_compat", so the Worker has no AsyncLocalStorage';

    it("warns once, never fails, when compatibility_flags lacks it", async () => {
      const cases = [
        ["wrangler.jsonc", '{\n  // no flags\n  "assets": { "directory": "dist/client" },\n}\n'],
        ["wrangler.json", '{ "compatibility_flags": [], "assets": { "directory": "dist/client" } }'],
        ["wrangler.json", '{ "compatibility_flags": ["global_fetch_strictly_public"], "assets": { "directory": "dist/client" } }'],
        ["wrangler.json", '{ "compatibility_flags": "nodejs_compat", "assets": { "directory": "dist/client" } }'],
        ["wrangler.toml", 'name = "app"\n[assets]\ndirectory = "dist/client"\n'],
        ["wrangler.toml", 'compatibility_flags = []\n[assets]\ndirectory = "dist/client"\n'],
      ] as const;
      for (const [file, text] of cases) {
        warn.mockClear();
        await writeFile(join(root, file), text);
        await expect(afterBuild(), text).resolves.toBeUndefined();
        await rm(join(root, file));
        expect(messages(), text).toEqual([expect.stringContaining(`file: ${file}\n  what: ${WARNING}`)]);
        expect(messages()[0], text).toContain('set "compatibility_flags": ["nodejs_compat"]');
        expect(messages()[0], text).toContain("droplets warning cloudflare-nodejs-compat-missing");
      }
    });

    it("stays silent with nodejs_compat, or the older nodejs_compat_v2, among other flags", async () => {
      for (const [file, text] of [
        ["wrangler.json", '{ "compatibility_flags": ["global_fetch_strictly_public", "nodejs_compat"], "assets": {} }'],
        ["wrangler.json", '{ "compatibility_flags": ["nodejs_compat_v2"], "assets": {} }'],
        [
          "wrangler.toml",
          'name = "app"\ncompatibility_flags = ["nodejs_compat"] # the request store\n\n[assets]\ndirectory = "dist/client"\n',
        ],
      ] as const) {
        await writeFile(join(root, file), text);
        await afterBuild();
        await rm(join(root, file));
      }
      expect(warn).not.toHaveBeenCalled();
    });
  });
});

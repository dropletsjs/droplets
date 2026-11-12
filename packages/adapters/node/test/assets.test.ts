import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DropletsManifest } from "@dropletsjs/droplets";
import { createAssetLoaders } from "../src/assets.ts";

describe("createAssetLoaders", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-manifest-"));
    const manifest: DropletsManifest = {
      __hash: "h4sh",
      __globalCss: "assets/global.css",
      __globalStyle: "index.css",
      __entryClient: "index.js",
      __entryModule: "assets/index.h4sh.js",
      __index: "<p>home</p>",
      __externals: ["ag-grid"],
      droplets: {
        hello: { client: "droplets/hello/client.js", css: ["assets/Badge.css", "assets/hello.css"] },
        plain: { client: "droplets/plain/client.js" },
      },
    };
    await mkdir(join(root, "assets"), { recursive: true });
    await mkdir(join(root, "droplets/hello"), { recursive: true });
    await writeFile(join(root, "droplets.json"), JSON.stringify(manifest));
    await writeFile(join(root, "assets/global.css"), "body{}");
    await writeFile(join(root, "index.css"), '@import url("./assets/global.css");\n');
    await writeFile(join(root, "index.js"), "entry");
    await writeFile(join(root, "assets/hello.css"), ".hello{}");
    await writeFile(join(root, "droplets/hello/client.js"), "hello");
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads the manifest once", async () => {
    const assets = createAssetLoaders({ clientRoot: root });
    const first = await assets.loadManifest();
    expect(first.__hash).toBe("h4sh");
    expect(await assets.loadManifest()).toBe(first);
  });

  it("loads bundles, styles and the entry client by manifest path", async () => {
    const assets = createAssetLoaders({ clientRoot: root });
    expect(await assets.loadClientModule("hello")).toBe("hello");
    expect(await assets.loadEntryClient()).toBe("entry");
    expect(await assets.entryModule()).toBe("assets/index.h4sh.js");
    expect(await assets.loadIndex()).toBe("<p>home</p>");
    // The stub /index.css serves; the stylesheet itself comes from /assets/.
    expect(await assets.loadGlobalStyle()).toBe('@import url("./assets/global.css");\n');
    // Paths, for style.css to import: the files themselves come from /assets/.
    expect(await assets.dropletStyles("hello")).toEqual(["assets/Badge.css", "assets/hello.css"]);
  });

  it("finds only droplets in the manifest, never prototype members", async () => {
    const assets = createAssetLoaders({ clientRoot: root });
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(await assets.loadClientModule(id), id).toBeNull();
      expect(await assets.dropletStyles(id), id).toEqual([]);
    }
  });

  it("answers no styles and no bundle for a droplet without them and for an unknown one", async () => {
    const assets = createAssetLoaders({ clientRoot: root });
    expect(await assets.dropletStyles("plain")).toEqual([]);
    expect(await assets.dropletStyles("nope")).toEqual([]);
    expect(await assets.loadClientModule("nope")).toBeNull();
    // Listed in the manifest but missing on disk.
    expect(await assets.loadClientModule("plain")).toBeNull();
  });

  it("falls back to defaults and logs an error once when droplets.json is missing, until a build lands", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const empty = await mkdtemp(join(tmpdir(), "droplets-manifest-empty-"));
    const path = join(empty, "droplets.json");
    try {
      const assets = createAssetLoaders({ clientRoot: empty });
      const manifest = await assets.loadManifest();
      expect(manifest.droplets).toEqual({});
      expect(manifest.__entryClient).toBe("index.js");
      expect(await assets.loadManifest()).toBe(manifest);
      expect(error).toHaveBeenCalledOnce();
      expect(error.mock.calls[0]).toEqual([`droplets.json not found at ${path}; did you build?`]);

      // The fallback is never kept: the next request reads the file again.
      await writeFile(path, JSON.stringify({ __hash: "built", __entryClient: "index.js", __globalStyle: "index.css", droplets: {} }));
      const built = await assets.loadManifest();
      expect(built.__hash).toBe("built");
      expect(await assets.loadManifest()).toBe(built);
      expect(error).toHaveBeenCalledOnce();
    } finally {
      vi.restoreAllMocks();
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("tells a malformed droplets.json apart, logs it once per failure, and reads it again next time", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = await mkdtemp(join(tmpdir(), "droplets-manifest-broken-"));
    const path = join(broken, "droplets.json");
    try {
      await writeFile(path, "{ half");
      const assets = createAssetLoaders({ clientRoot: broken });
      expect((await assets.loadManifest()).droplets).toEqual({});
      expect(await assets.loadClientModule("hello")).toBeNull();
      expect(error).toHaveBeenCalledOnce();
      const [message] = error.mock.calls[0] ?? [];
      expect(message).toMatch(/is not valid JSON: /);
      expect(message).toContain(path);
      expect(message).not.toContain("not found");

      // A different failure is logged again; the same one is not.
      await rm(path);
      expect((await assets.loadManifest()).droplets).toEqual({});
      expect((await assets.loadManifest()).droplets).toEqual({});
      expect(error).toHaveBeenCalledTimes(2);
      expect(error.mock.calls[1]).toEqual([`droplets.json not found at ${path}; did you build?`]);

      // Once it loads, it is kept, and a later failure logs anew.
      await writeFile(path, JSON.stringify({ __hash: "fixed", __entryClient: "index.js", __globalStyle: "index.css", droplets: {} }));
      expect((await assets.loadManifest()).__hash).toBe("fixed");
      expect(error).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
      await rm(broken, { recursive: true, force: true });
    }
  });
});

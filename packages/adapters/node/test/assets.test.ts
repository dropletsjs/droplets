import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setLogLevel, type DropletsManifest } from "@dropletsjs/droplets";
import { createAssetLoaders } from "../src/assets.ts";

describe("createAssetLoaders", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-manifest-"));
    const manifest: DropletsManifest = {
      __hash: "h4sh",
      __globalCss: "assets/global.css",
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
    expect(await assets.loadGlobalStyle()).toBe("body{}");
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

  it("falls back to defaults and warns when droplets.json is missing", async () => {
    setLogLevel("warn");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const empty = await mkdtemp(join(tmpdir(), "droplets-manifest-empty-"));
    try {
      const assets = createAssetLoaders({ clientRoot: empty });
      const manifest = await assets.loadManifest();
      expect(manifest.droplets).toEqual({});
      expect(manifest.__entryClient).toBe("index.js");
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]?.[0])).toContain("did you build?");
    } finally {
      vi.restoreAllMocks();
      setLogLevel("error");
      await rm(empty, { recursive: true, force: true });
    }
  });
});

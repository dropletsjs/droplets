import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAssetHandler } from "../src/static.ts";

describe("createAssetHandler", () => {
  let root: string;
  let app: Hono;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-static-"));
    await mkdir(join(root, "assets/chunks"), { recursive: true });
    await writeFile(join(root, "assets/chunks/a-123.js"), "export const a = 1;");
    await writeFile(join(root, "assets/style-abc.css"), "p{}");
    await writeFile(join(root, "assets/font.woff2"), "font");
    await writeFile(join(root, "assets/blob.unknown"), "?");
    await writeFile(join(root, "droplets.json"), "{}");
    app = new Hono();
    app.get("/assets/*", createAssetHandler(root));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("serves files with a content type and immutable caching", async () => {
    const js = await app.request("/assets/chunks/a-123.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    expect(js.headers.get("cache-control")).toBe("public, max-age=2592000, immutable");
    expect(await js.text()).toBe("export const a = 1;");

    const css = await app.request("/assets/style-abc.css");
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");

    const font = await app.request("/assets/font.woff2");
    expect(font.headers.get("content-type")).toBe("font/woff2");

    const other = await app.request("/assets/blob.unknown");
    expect(other.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("404s missing files", async () => {
    expect((await app.request("/assets/nope.js")).status).toBe(404);
  });

  it("refuses to escape the assets directory", async () => {
    const encoded = await app.request("/assets/..%2Fdroplets.json");
    expect(encoded.status).toBe(404);
    const dir = await app.request("/assets/");
    expect(dir.status).toBe(404);
  });
});

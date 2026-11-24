import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/core/config.ts";
import { applyFileHeaders, type FileHeaderRule, fileHeadersFor, fileHeaderTable } from "../../src/runtime/file-headers.ts";

const IMMUTABLE = "public, max-age=2592000, immutable";

describe("fileHeaderTable", () => {
  it("lists every build file, a narrower pattern after the wider one it refines", () => {
    expect(fileHeaderTable(resolveConfig({}))).toEqual([
      { path: "/index.js", headers: { "Cache-Control": "no-store" } },
      { path: "/index.css", headers: { "Cache-Control": "no-store" } },
      { path: "/assets/*", headers: { "X-Content-Type-Options": "nosniff", "Cache-Control": IMMUTABLE } },
      { path: "/assets/public/*", headers: { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" } },
      { path: "/droplets/:id/client.js", headers: { "Cache-Control": IMMUTABLE } },
      { path: "/droplets/:id/style.css", headers: { "Cache-Control": IMMUTABLE } },
    ]);
  });

  it("takes publicCacheControl for /assets/public/*, and no Cache-Control there for false", () => {
    const table = (publicCacheControl: string | false) => fileHeaderTable(resolveConfig({ publicCacheControl }));
    expect(fileHeadersFor({ table: table("public, max-age=60"), path: "/assets/public/a.txt" })).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=60",
    });
    expect(fileHeadersFor({ table: table(false), path: "/assets/public/a.txt" })).toEqual({ "X-Content-Type-Options": "nosniff" });
    expect(fileHeadersFor({ table: table(false), path: "/assets/a.js" })?.["Cache-Control"]).toBe(IMMUTABLE);
  });
});

describe("fileHeadersFor", () => {
  const table = fileHeaderTable(resolveConfig({}));
  const cacheOf = (path: string) => fileHeadersFor({ table, path })?.["Cache-Control"];

  it("gives a path the last rule that matches", () => {
    expect(cacheOf("/index.js")).toBe("no-store");
    expect(cacheOf("/assets/index.abc.js")).toBe(IMMUTABLE);
    expect(cacheOf("/assets/chunks/a/b.js")).toBe(IMMUTABLE);
    expect(cacheOf("/assets/public/img/logo.svg")).toBe("no-cache");
    expect(cacheOf("/assets//public/logo.svg")).toBe("no-cache");
    expect(cacheOf("/droplets/hello/client.js")).toBe(IMMUTABLE);
    expect(cacheOf("/droplets/hello/style.css")).toBe(IMMUTABLE);
  });

  it("matches a :name segment with one non-empty segment and a final * with a non-empty rest", () => {
    for (const path of [
      "/",
      "/index.json",
      "/env.js",
      "/assets",
      "/assets/",
      "/assetsx/a.js",
      "/droplets/hello",
      "/droplets/hello/_data",
      "/droplets//client.js",
      "/droplets/a/b/client.js",
      "/x/index.js",
    ]) {
      expect(fileHeadersFor({ table, path }), path).toBeUndefined();
    }
  });
});

describe("applyFileHeaders", () => {
  const table: FileHeaderRule[] = [
    { path: "/a/*", headers: { "Cache-Control": "one", "X-One": "1" } },
    { path: "/a/b/*", headers: { "X-Two": "2" } },
  ];

  it("sets the rule's headers and removes the others the table names, leaving the rest", () => {
    const headers = new Headers({ "cache-control": "platform", "x-one": "old", "content-type": "text/plain" });
    expect(applyFileHeaders({ table, path: "/a/b/c", headers })).toBe(true);
    expect([...headers]).toEqual([
      ["content-type", "text/plain"],
      ["x-two", "2"],
    ]);
  });

  it("leaves a path no rule matches as it is", () => {
    const headers = new Headers({ "cache-control": "platform" });
    expect(applyFileHeaders({ table, path: "/b", headers })).toBe(false);
    expect(headers.get("cache-control")).toBe("platform");
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverApiRoutes, parseSegment, routeFromFolders } from "../../src/core/api-routes.ts";

describe("parseSegment", () => {
  it.each([
    ["users", { type: "static", value: "users" }],
    ["[id]", { type: "param", name: "id" }],
    ["[...path]", { type: "rest", name: "path" }],
    ["(admin)", null],
  ])("%s", (folder, expected) => {
    expect(parseSegment(folder, "x/+server.ts")).toEqual(expected);
  });

  it.each(["[id=int]", "[[lang]]", "a[b]", "[1x]"])("rejects %s for now", (folder) => {
    expect(() => parseSegment(folder, "x/+server.ts")).toThrow(/unsupported route segment/);
  });
});

describe("routeFromFolders", () => {
  it("prefixes /api and drops groups from the id", () => {
    const route = routeFromFolders(["(admin)", "users", "[id]"], "(admin)/users/[id]/+server.ts");
    expect(route.id).toBe("/api/users/[id]");
    expect(route.segments).toEqual([
      { type: "static", value: "api" },
      { type: "static", value: "users" },
      { type: "param", name: "id" },
    ]);
  });

  it("maps the folder root to /api", () => {
    expect(routeFromFolders([], "+server.ts").id).toBe("/api");
  });

  it("rejects repeated parameter names and segments after a rest", () => {
    expect(() => routeFromFolders(["[id]", "x", "[id]"], "f")).toThrow(/appears twice/);
    expect(() => routeFromFolders(["[...rest]", "x"], "f")).toThrow(/must be the last/);
  });
});

describe("discoverApiRoutes", () => {
  let root: string;

  const touch = async (file: string) => {
    await mkdir(join(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), "export const GET = () => new Response();\n");
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-api-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds +server files at any depth, most specific first", async () => {
    await touch("+server.ts");
    await touch("users/[id]/+server.ts");
    await touch("users/me/+server.js");
    await touch("files/[...path]/+server.ts");
    await touch("(internal)/stats/+server.ts");
    await touch("users/[id]/helpers.ts");

    const routes = await discoverApiRoutes(root);
    // Routes that can answer the same URL are ordered most specific first;
    // the rest only need a stable order.
    expect(routes.map((r) => r.id)).toEqual(["/api/users/me", "/api/users/[id]", "/api/files/[...path]", "/api/stats", "/api"]);
    expect(routes.find((r) => r.id === "/api/users/me")?.file).toBe("users/me/+server.js");
  });

  it("refuses two files that answer the same URLs", async () => {
    await touch("users/[id]/+server.ts");
    await touch("users/[slug]/+server.ts");
    await expect(discoverApiRoutes(root)).rejects.toThrow(/both answer/);
  });

  it("returns nothing for a missing folder", async () => {
    expect(await discoverApiRoutes(join(root, "nope"))).toEqual([]);
  });
});

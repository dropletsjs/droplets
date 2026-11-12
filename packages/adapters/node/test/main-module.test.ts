import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isMainModule } from "../src/main-module.ts";

describe("isMainModule", () => {
  let root: string;
  let moduleUrl: string;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "droplets-main-")));
    await mkdir(join(root, "dist"));
    await mkdir(join(root, "link"));
    await writeFile(join(root, "dist/server.js"), "");
    await writeFile(join(root, "dist/other.js"), "");
    await symlink(join("..", "dist", "server.js"), join(root, "link/server.js"));
    await symlink(join("..", "dist"), join(root, "link/dist"));
    moduleUrl = pathToFileURL(join(root, "dist/server.js")).href;
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("is true for the file itself, with or without the extension, and through a symlink", () => {
    expect(isMainModule({ moduleUrl, argv1: join(root, "dist/server.js") })).toBe(true);
    expect(isMainModule({ moduleUrl, argv1: join(root, "dist/server") })).toBe(true);
    expect(isMainModule({ moduleUrl, argv1: join(root, "link/server.js") })).toBe(true);
    expect(isMainModule({ moduleUrl, argv1: join(root, "link/server") })).toBe(true);
    expect(isMainModule({ moduleUrl, argv1: join(root, "link/dist/server.js") })).toBe(true);
  });

  it("is false for another file, a missing one and no argument", () => {
    expect(isMainModule({ moduleUrl, argv1: join(root, "dist/other.js") })).toBe(false);
    expect(isMainModule({ moduleUrl, argv1: join(root, "dist/other") })).toBe(false);
    expect(isMainModule({ moduleUrl, argv1: join(root, "dist/nope.js") })).toBe(false);
    expect(isMainModule({ moduleUrl, argv1: join(root, "dist") })).toBe(false);
    expect(isMainModule({ moduleUrl, argv1: undefined })).toBe(false);
    expect(isMainModule({ moduleUrl: pathToFileURL(join(root, "dist/gone.js")).href, argv1: join(root, "dist/gone.js") })).toBe(false);
  });
});

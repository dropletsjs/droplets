import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileExists, loadDirectoryNames, loadJsonFile, loadTextFile, writeTextFile } from "../../src/core/fs.ts";

describe("fs helpers", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-fs-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("fileExists is true for files only", async () => {
    await writeFile(join(root, "a.txt"), "a");
    expect(await fileExists({ path: join(root, "a.txt") })).toBe(true);
    expect(await fileExists({ path: root })).toBe(false);
    expect(await fileExists({ path: join(root, "missing") })).toBe(false);
  });

  it("loadTextFile returns null for a missing file", async () => {
    expect(await loadTextFile({ path: join(root, "missing") })).toBeNull();
    expect(await loadTextFile({ path: join(root, "a.txt") })).toBe("a");
  });

  it("writeTextFile creates parent directories", async () => {
    const path = join(root, "deep/er/file.txt");
    await writeTextFile({ path, contents: "hello" });
    expect(await loadTextFile({ path: path })).toBe("hello");
  });

  it("loadJsonFile returns null for missing or malformed JSON", async () => {
    await writeFile(join(root, "ok.json"), '{"a":1}');
    await writeFile(join(root, "bad.json"), "{nope");
    expect(await loadJsonFile({ path: join(root, "ok.json") })).toEqual({ a: 1 });
    expect(await loadJsonFile({ path: join(root, "bad.json") })).toBeNull();
    expect(await loadJsonFile({ path: join(root, "missing.json") })).toBeNull();
  });

  it("loadDirectoryNames lists folders only and tolerates a missing path", async () => {
    expect(await loadDirectoryNames({ path: join(root, "nowhere") })).toEqual([]);
    const names = await loadDirectoryNames({ path: root });
    expect(names).toContain("deep");
    expect(names).not.toContain("a.txt");
  });
});

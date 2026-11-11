import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileExists, listDirectories, readJsonFile, readTextFile, writeTextFile } from "../../src/core/fs.ts";

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
    expect(await fileExists(join(root, "a.txt"))).toBe(true);
    expect(await fileExists(root)).toBe(false);
    expect(await fileExists(join(root, "missing"))).toBe(false);
  });

  it("readTextFile returns null for a missing file", async () => {
    expect(await readTextFile(join(root, "missing"))).toBeNull();
    expect(await readTextFile(join(root, "a.txt"))).toBe("a");
  });

  it("writeTextFile creates parent directories", async () => {
    const path = join(root, "deep/er/file.txt");
    await writeTextFile(path, "hello");
    expect(await readTextFile(path)).toBe("hello");
  });

  it("readJsonFile returns null for missing or malformed JSON", async () => {
    await writeFile(join(root, "ok.json"), '{"a":1}');
    await writeFile(join(root, "bad.json"), "{nope");
    expect(await readJsonFile(join(root, "ok.json"))).toEqual({ a: 1 });
    expect(await readJsonFile(join(root, "bad.json"))).toBeNull();
    expect(await readJsonFile(join(root, "missing.json"))).toBeNull();
  });

  it("listDirectories lists folders only and tolerates a missing path", async () => {
    expect(await listDirectories(join(root, "nowhere"))).toEqual([]);
    const names = await listDirectories(root);
    expect(names).toContain("deep");
    expect(names).not.toContain("a.txt");
  });
});

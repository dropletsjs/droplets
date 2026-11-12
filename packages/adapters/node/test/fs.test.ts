import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadJsonFile, loadTextFile, MalformedJsonError } from "../src/fs.ts";

describe("fs", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-fs-"));
    await writeFile(join(root, "text.txt"), "héllo");
    await writeFile(join(root, "good.json"), '{"a":1}');
    await writeFile(join(root, "bad.json"), "{a:");
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("loads text, null for a missing file, and throws any other failure", async () => {
    expect(await loadTextFile({ path: join(root, "text.txt") })).toBe("héllo");
    expect(await loadTextFile({ path: join(root, "nope.txt") })).toBeNull();
    await expect(loadTextFile({ path: root })).rejects.toMatchObject({ code: "EISDIR" });
  });

  it("loads JSON, null when missing, and tells a malformed file apart by its own error", async () => {
    expect(await loadJsonFile({ path: join(root, "good.json") })).toEqual({ a: 1 });
    expect(await loadJsonFile({ path: join(root, "nope.json") })).toBeNull();
    const failure = await loadJsonFile({ path: join(root, "bad.json") }).then(
      () => expect.unreachable("a parse error"),
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(MalformedJsonError);
    expect(failure).toMatchObject({ name: "MalformedJsonError", path: join(root, "bad.json") });
    expect((failure as Error).message.startsWith(`${join(root, "bad.json")} is not valid JSON: `)).toBe(true);
    expect((failure as Error).cause).toBeInstanceOf(SyntaxError);
  });
});

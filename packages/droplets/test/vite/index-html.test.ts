import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_INDEX_HTML, readIndexHtml } from "../../src/vite/index-html.ts";

describe("readIndexHtml", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-index-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("serves the placeholder when there is no index.html", async () => {
    expect(await readIndexHtml(root, undefined)).toBe(DEFAULT_INDEX_HTML);
    expect(DEFAULT_INDEX_HTML).toContain("Powering Microfrontends with <strong>DropletsJS</strong>");
  });

  it("prefers index.html in the root", async () => {
    await writeFile(join(root, "index.html"), "<p>root</p>");
    expect(await readIndexHtml(root, undefined)).toBe("<p>root</p>");
  });

  it("reads the configured file, and fails loudly when it is missing", async () => {
    await writeFile(join(root, "home.html"), "<p>home</p>");
    expect(await readIndexHtml(root, "./home.html")).toBe("<p>home</p>");
    await expect(readIndexHtml(root, "./nope.html")).rejects.toThrow(/does not exist/);
  });

  it("returns null when turned off", async () => {
    await writeFile(join(root, "index.html"), "<p>root</p>");
    expect(await readIndexHtml(root, false)).toBeNull();
  });
});

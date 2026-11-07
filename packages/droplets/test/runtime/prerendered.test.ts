/**
 * `createPrerenderedLoader`: what a request can make it read. The droplet
 * name and the props key come from a request; the index and the renders
 * from the build.
 */
import { describe, expect, it } from "vitest";
import { createPrerenderedLoader, PRERENDER_DIR } from "../../src/server/prerendered.ts";

/** A renders' directory in memory; records every path read. */
function files(entries: Record<string, string>) {
  const reads: string[] = [];
  const read = async (path: string) => {
    reads.push(path);
    return Object.hasOwn(entries, path) ? entries[path]! : null;
  };
  return { read, reads };
}

const RENDER = JSON.stringify({ html: "<p>stored</p>", data: { a: 1 }, nonce: "0123456789abcdef" });

describe("createPrerenderedLoader", () => {
  it("reads the index, then the render it names, relative to the renders' directory", async () => {
    const { read, reads } = files({
      "docs/index.json": JSON.stringify({ '{"page":1}': "docs/aaaa.json" }),
      "docs/aaaa.json": RENDER,
    });
    const load = createPrerenderedLoader(read);
    expect(await load("docs", '{"page":1}')).toMatchObject({ html: "<p>stored</p>", data: { a: 1 } });
    // The directory is the adapter's: nothing under the public `_prerendered/` path.
    expect(reads.every((path) => !path.startsWith(PRERENDER_DIR))).toBe(true);
    // The index once per droplet.
    await load("docs", '{"page":1}');
    expect(reads.filter((path) => path === "docs/index.json")).toHaveLength(1);
  });

  it("reads nothing for a droplet name that is not one path segment", async () => {
    const { read, reads } = files({ "index.json": JSON.stringify({ k: "x.json" }), "x.json": RENDER });
    const load = createPrerenderedLoader(read);
    for (const name of ["", ".", "..", "../docs", "docs/../..", "a\\b", "a\0b"]) {
      expect(await load(name, "k"), name).toBeNull();
    }
    expect(reads).toEqual([]);
  });

  it("never takes a key from Object.prototype", async () => {
    const { read, reads } = files({ "docs/index.json": JSON.stringify({ '{"page":1}': "docs/aaaa.json" }) });
    const load = createPrerenderedLoader(read);
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(await load("docs", key), key).toBeNull();
    }
    expect(reads).toEqual(["docs/index.json"]);
  });

  it("ignores an index or a render that is not what the build writes", async () => {
    const { read } = files({
      "a/index.json": "not json",
      "b/index.json": JSON.stringify(["b/x.json"]),
      "c/index.json": JSON.stringify({ k: 42 }),
      "d/index.json": JSON.stringify({ k: "d/x.json" }),
      "d/x.json": JSON.stringify({ html: 1 }),
      "e/index.json": "null",
    });
    const load = createPrerenderedLoader(read);
    for (const droplet of ["a", "b", "c", "d", "e", "missing"]) {
      expect(await load(droplet, "k"), droplet).toBeNull();
      expect(await load(droplet, "0"), droplet).toBeNull();
    }
  });
});

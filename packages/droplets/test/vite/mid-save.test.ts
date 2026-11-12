import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { untilWritten } from "../../src/vite/mid-save.ts";

describe("untilWritten", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-mid-save-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns at once for a file with content, or a file that is gone", async () => {
    const file = join(root, "full.vue");
    await writeFile(file, "<template><p>hi</p></template>\n");
    const started = Date.now();
    await untilWritten({ file, within: 5_000 });
    await untilWritten({ file: join(root, "gone.vue"), within: 5_000 });
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("waits for the second write of a save that empties the file first", async () => {
    const file = join(root, "two-writes.vue");
    await writeFile(file, "");
    const written = new Promise<void>((done) =>
      setTimeout(() => void writeFile(file, "<template><p>hey</p></template>\n").then(done), 300),
    );
    let settled = false;
    const waiting = untilWritten({ file, within: 5_000 }).then(() => (settled = true));
    await new Promise((wake) => setTimeout(wake, 150));
    expect(settled).toBe(false);
    await Promise.all([written, waiting]);
  });

  it("gives up after the window on a file left empty", async () => {
    const file = join(root, "empty.vue");
    await writeFile(file, "");
    const started = Date.now();
    await untilWritten({ file, within: 200 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
  });
});

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("../src/", import.meta.url));

/**
 * Everything that runs inside the production server, or in the browser, must
 * work on any JavaScript runtime: Node, Workers, Deno, Bun. Only the
 * per-runtime adapters (`server/<runtime>/`) and the build tooling may use
 * Node APIs. This test keeps that line from moving by accident.
 */
const NEUTRAL = ["runtime", "server", "core/config.ts", "core/logger.ts"];

const FORBIDDEN: Array<[string, RegExp]> = [
  ["node: import", /from\s+["']node:/],
  ["Buffer", /\bBuffer\b/],
  ["process.argv/cwd/exit", /\bprocess\.(argv|cwd|exit)\b/],
  ["unguarded process.env", /(?<!typeof process === "undefined" \? undefined : )process\.env\b/],
  ["__dirname", /\b__dirname\b/],
];

async function files(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) out.push(...(await files(full)));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("runtime portability", () => {
  it("keeps Node-only APIs out of the runtime-neutral modules", async () => {
    const offenders: string[] = [];
    for (const target of NEUTRAL) {
      const path = join(src, target);
      const list = target.endsWith(".ts") ? [path] : await files(path);
      for (const file of list) {
        const text = await readFile(file, "utf8");
        for (const [label, pattern] of FORBIDDEN) {
          if (pattern.test(text)) offenders.push(`${relative(src, file)}: ${label}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

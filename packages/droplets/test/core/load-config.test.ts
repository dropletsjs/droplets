import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CONFIG_FILE_CANDIDATES,
  findConfigFile,
  loadDropletsConfig,
} from "../../src/core/load-config.ts";

const env = { command: "serve", mode: "development" } as const;

describe("findConfigFile", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-config-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns null when nothing is there", async () => {
    expect(await findConfigFile(root)).toBeNull();
  });

  it("throws for an explicit file that is missing", async () => {
    await expect(findConfigFile(root, "custom.config.ts")).rejects.toThrow(
      /config file not found/,
    );
  });

  it("prefers candidates in order", async () => {
    await writeFile(join(root, "droplets.config.js"), "export default {};");
    expect(await findConfigFile(root)).toBe(join(root, "droplets.config.js"));
    await writeFile(join(root, "droplets.config.ts"), "export default {};");
    expect(await findConfigFile(root)).toBe(join(root, CONFIG_FILE_CANDIDATES[0]));
  });
});

describe("loadDropletsConfig", () => {
  let root: string;

  beforeAll(async () => {
    // Vite reports dependencies as real paths; macOS puts tmp behind a symlink.
    root = await realpath(await mkdtemp(join(tmpdir(), "droplets-load-config-")));
    // Mark the folder as ESM, as any real project's package.json would.
    await writeFile(join(root, "package.json"), '{ "type": "module" }');
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves defaults when there is no config file", async () => {
    const loaded = await loadDropletsConfig(root, env);
    expect(loaded.path).toBeNull();
    expect(loaded.dependencies).toEqual([]);
    expect(loaded.config.dropletsFolder).toBe("src/droplets");
  });

  it("loads a TypeScript config file with its imports", async () => {
    await writeFile(
      join(root, "ports.ts"),
      "export const port: number = 9876;\n",
    );
    await writeFile(
      join(root, "droplets.config.ts"),
      [
        'import { port } from "./ports.ts";',
        "type Shape = { dropletsFolder: string; cors: boolean; server: { port: number } };",
        'const value: Shape = { dropletsFolder: "./src/droplets/", cors: true, server: { port } };',
        "export default value;",
        "",
      ].join("\n"),
    );

    const loaded = await loadDropletsConfig(root, env);
    expect(loaded.path).toBe(join(root, "droplets.config.ts"));
    expect(loaded.config.dropletsFolder).toBe("src/droplets");
    expect(loaded.config.cors).toEqual({ origin: "*" });
    expect(loaded.config.server.port).toBe(9876);
    expect(loaded.dependencies).toContain(join(root, "ports.ts"));
  });

  it("honours an explicit configFile", async () => {
    await writeFile(
      join(root, "other.config.ts"),
      'export default { dropletsFolder: "widgets" };\n',
    );
    const loaded = await loadDropletsConfig(root, env, "other.config.ts");
    expect(loaded.config.dropletsFolder).toBe("widgets");
  });
});

import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CONFIG_FILE_CANDIDATES, findConfigFile, loadDropletsConfig } from "../../src/core/load-config.ts";
import { setLogLevel } from "../../src/core/logger.ts";

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
    expect(await findConfigFile({ root })).toBeNull();
  });

  it("throws for an explicit file that is missing", async () => {
    await expect(findConfigFile({ root, configFile: "custom.config.ts" })).rejects.toThrow(/config file not found/);
  });

  it("prefers candidates in order", async () => {
    await writeFile(join(root, "droplets.config.js"), "export default {};");
    expect(await findConfigFile({ root })).toBe(join(root, "droplets.config.js"));
    await writeFile(join(root, "droplets.config.ts"), "export default {};");
    expect(await findConfigFile({ root })).toBe(join(root, CONFIG_FILE_CANDIDATES[0]));
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
    setLogLevel("error");
    await rm(root, { recursive: true, force: true });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("resolves defaults when there is no config file", async () => {
    const loaded = await loadDropletsConfig({ root, configEnv: env });
    expect(loaded.path).toBeNull();
    expect(loaded.dependencies).toEqual([]);
    expect(loaded.config.dropletsFolder).toBe("src/droplets");
  });

  it("loads a TypeScript config file with its imports", async () => {
    await writeFile(join(root, "ports.ts"), "export const port: number = 9876;\n");
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

    const loaded = await loadDropletsConfig({ root, configEnv: env });
    expect(loaded.path).toBe(join(root, "droplets.config.ts"));
    expect(loaded.config.dropletsFolder).toBe("src/droplets");
    expect(loaded.config.cors).toEqual({ origin: "*" });
    expect(loaded.config.server.port).toBe(9876);
    expect(loaded.dependencies).toContain(join(root, "ports.ts"));
  });

  it("warns once under vite dev about a PORT that is no port, and ignores it", async () => {
    setLogLevel("warn");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("PORT", "70000");
    const loaded = await loadDropletsConfig({ root, configEnv: env });
    expect(loaded.config.server.port).toBe(9876);
    expect(loaded.dev.server.port).toBe(5173);
    await loadDropletsConfig({ root, configEnv: env });
    const messages = warn.mock.calls.map((call) => String(call[0])).filter((m) => m.includes("PORT"));
    expect(messages).toEqual(['[droplets:framework] PORT is "70000", not a port (an integer from 0 to 65535); ignoring it']);
    // A build reads PORT for nothing it writes: silent.
    vi.stubEnv("PORT", "nope");
    await loadDropletsConfig({ root, configEnv: { command: "build", mode: "production" } });
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("nope"))).toHaveLength(0);
  });

  it("honours an explicit configFile", async () => {
    await writeFile(join(root, "other.config.ts"), 'export default { dropletsFolder: "widgets" };\n');
    const loaded = await loadDropletsConfig({ root, configEnv: env, configFile: "other.config.ts" });
    expect(loaded.config.dropletsFolder).toBe("widgets");
  });
});

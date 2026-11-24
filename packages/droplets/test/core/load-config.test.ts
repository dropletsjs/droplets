import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CONFIG_FILE_CANDIDATES, findConfigFile, loadDropletsConfig } from "../../src/core/load-config.ts";
import { logger, setLogLevel } from "../../src/core/logger.ts";
import { SCRIPT_HYDRATE_LOCKED } from "../../src/errors/config.ts";
import { formatAgent, setErrorFormatter } from "../../src/errors/format.ts";
import { validateRenderers } from "../../src/renderer.ts";

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

  it("never reads PORT: vite dev keeps dev.server.port, and a build keeps server.port of the file", async () => {
    setLogLevel("warn");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const port of ["9000", "70000", "nope"]) {
      vi.stubEnv("PORT", port);
      const served = await loadDropletsConfig({ root, configEnv: env });
      expect(served.dev.server.port, port).toBe(5173);
      expect(served.config.server.port, port).toBe(9876);
      const built = await loadDropletsConfig({ root, configEnv: { command: "build", mode: "production" } });
      expect(built.config.server.port, port).toBe(9876);
    }
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("PORT"))).toHaveLength(0);
  });

  it("honours an explicit configFile", async () => {
    await writeFile(join(root, "other.config.ts"), 'export default { dropletsFolder: "widgets" };\n');
    const loaded = await loadDropletsConfig({ root, configEnv: env, configFile: "other.config.ts" });
    expect(loaded.config.dropletsFolder).toBe("widgets");
  });
});

describe('errorFormat "human" in droplets.config.ts', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-config-human-"));
  });
  afterEach(() => {
    setErrorFormatter(formatAgent);
    setLogLevel("error");
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes the plugin's thrown errors and logged warnings on one line from then on", async () => {
    await writeFile(join(root, "droplets.config.ts"), 'export default { errorFormat: "human" };');
    expect((await loadDropletsConfig({ root, configEnv: env })).config.errorFormat).toBe("human");

    expect(() => validateRenderers([{ name: "" } as never])).toThrow(
      expect.objectContaining({
        code: "renderer-name-missing",
        message:
          "droplets: every renderer needs a name; give the renderer a name, as the first-party factories do (https://dropletsjs.dev/errors/renderer-name-missing/)",
      }),
    );
    setLogLevel("warn");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.report({ message: SCRIPT_HYDRATE_LOCKED, droplet: "tracker", file: "+droplet.script.ts" });
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      "droplets: tracker: +droplet.script.ts: exports hydrate = true; a script droplet is always hydrated (locked to true); remove the export (https://dropletsjs.dev/errors/script-hydrate-locked/)",
    ]);
  });

  it("writes the config's own errors in that format too", async () => {
    await writeFile(join(root, "droplets.config.ts"), 'export default { errorFormat: "human", render: { timeout: -5 } };');
    await expect(loadDropletsConfig({ root, configEnv: env })).rejects.toThrow(
      expect.objectContaining({
        code: "render-timeout-negative",
        message: expect.stringMatching(/^droplets: render\.timeout cannot be negative, got -5; use 0 /),
      }),
    );
  });

  it("stays with labelled lines by default", async () => {
    await writeFile(join(root, "droplets.config.ts"), "export default {};");
    await loadDropletsConfig({ root, configEnv: env });
    expect(() => validateRenderers([{ name: "" } as never])).toThrow(/^droplets error renderer-name-missing\n/);
  });
});

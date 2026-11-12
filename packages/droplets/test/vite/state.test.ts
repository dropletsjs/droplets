import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setLogLevel } from "../../src/core/logger.ts";
import { CLIENT_HOOKS_FILES, HOOKS_FILES, IMPORTMAP_FILES, warnMisnamedModules } from "../../src/vite/state.ts";

describe("the files looked up by name", () => {
  it("are .ts then .js for the server modules, four extensions for hooks.client", () => {
    expect(HOOKS_FILES).toEqual(["src/hooks.server.ts", "src/hooks.server.js"]);
    expect(IMPORTMAP_FILES).toEqual(["src/importmap.server.ts", "src/importmap.server.js"]);
    expect(CLIENT_HOOKS_FILES).toEqual(["src/hooks.client.ts", "src/hooks.client.mts", "src/hooks.client.js", "src/hooks.client.mjs"]);
  });
});

describe("warnMisnamedModules", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-state-"));
    setLogLevel("warn");
  });
  afterAll(async () => {
    setLogLevel("error");
    await rm(root, { recursive: true, force: true });
  });

  it("names, once, a hooks.server or importmap.server file with an extension that is not loaded", async () => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/hooks.server.mts"), "export const handle = ({ resolve, event }) => resolve(event);\n");
    await writeFile(join(root, "src/importmap.server.cjs"), "");
    await writeFile(join(root, "src/hooks.client.mts"), "export const init = () => {};\n");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await warnMisnamedModules({ root });
    await warnMisnamedModules({ root });
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      "[droplets:framework] src/hooks.server.mts is not loaded; name it src/hooks.server.ts or src/hooks.server.js",
      "[droplets:framework] src/importmap.server.cjs is not loaded; name it src/importmap.server.ts or src/importmap.server.js",
    ]);
    warn.mockRestore();
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPrivateEnvCode,
  buildPublicEnvCode,
  dynamicPublicNames,
  loadEnvState,
  missingStatic,
  type EnvState,
} from "../../src/core/env.ts";
import { defineEnvVars, validateEnvDeclaration } from "../../src/env.ts";

const state = (over: Partial<EnvState> = {}): EnvState => ({
  path: "/proj/src/env.ts",
  declaration: {
    API_KEY: {},
    BUILD_FLAG: { static: true },
    PUBLIC_NAME: { public: true, static: true },
    PUBLIC_API: { public: true },
  },
  values: { API_KEY: "secret", BUILD_FLAG: "on", PUBLIC_NAME: "Site", PUBLIC_API: "https://api", UNDECLARED: "x" },
  dependencies: [],
  ...over,
});

describe("defineEnvVars", () => {
  it("returns the declaration and validates it", () => {
    const vars = { A: {}, PUBLIC_B: { public: true } };
    expect(defineEnvVars(vars)).toBe(vars);
  });

  it("rejects bad names and missing options", () => {
    expect(() => validateEnvDeclaration({ "1X": {} })).toThrow(/not a valid environment variable name/);
    expect(() => validateEnvDeclaration({ A: null as never })).toThrow(/options object/);
    expect(() => validateEnvDeclaration({ P: { public: true, static: false } })).not.toThrow();
  });
});

describe("generated modules", () => {
  it("$droplets/env/public holds public variables only", () => {
    for (const target of [
      { browser: true as const, serverKey: "djs:b1" },
      { browser: false as const, envStorePath: "/s.js" },
    ]) {
      const code = buildPublicEnvCode(state(), target);
      expect(code).toContain('"PUBLIC_NAME": "Site"');
      expect(code).not.toContain("secret");
      expect(code).not.toContain("BUILD_FLAG");
      expect(code).not.toContain("UNDECLARED");
      // Read at runtime: the build-time value is never written into the bundle.
      expect(code).not.toContain("https://api");
    }
  });

  it("$droplets/env/public reads runtime values from the environment on the server", () => {
    const code = buildPublicEnvCode(state(), { browser: false, envStorePath: "/pkg/env-store.js" });
    expect(code).toContain('import { readRuntimeEnv } from "/pkg/env-store.js";');
    expect(code).toContain('get "PUBLIC_API"() { return readRuntimeEnv("PUBLIC_API"); }');
  });

  it("$droplets/env/public reads runtime values from this server's record in the browser", async () => {
    const code = buildPublicEnvCode(state(), { browser: true, serverKey: "djs:b1" });
    const { env } = (await import(`data:text/javascript,${encodeURIComponent(code)}`)) as {
      env: Record<string, string | undefined>;
    };
    const servers = Symbol.for("droplets.servers");
    const global = globalThis as { [servers]?: Record<string, { env?: Record<string, string> }> };
    expect(env["PUBLIC_API"]).toBeUndefined();
    // Another server on the page, even with the same build hash, keeps its own values.
    global[servers] = {
      "djs:b1": { env: { PUBLIC_API: "https://runtime" } },
      "other:b1": { env: { PUBLIC_API: "other" } },
    };
    expect(env["PUBLIC_API"]).toBe("https://runtime");
    expect(env["PUBLIC_NAME"]).toBe("Site");
    delete global[servers];
  });

  it("lists the public variables read at runtime", () => {
    expect(dynamicPublicNames(state())).toEqual(["PUBLIC_API"]);
  });

  it("$droplets/env/private inlines static values and reads the rest at runtime", () => {
    const code = buildPrivateEnvCode(state(), "/pkg/dist/runtime/env-store.js");
    expect(code).toContain('import { readRuntimeEnv } from "/pkg/dist/runtime/env-store.js";');
    expect(code).toContain('"BUILD_FLAG": "on"');
    expect(code).toContain('get "API_KEY"() { return readRuntimeEnv("API_KEY"); }');
    // The runtime value is never written into the bundle.
    expect(code).not.toContain("secret");
    expect(code).not.toContain("PUBLIC_NAME");
  });

  it("evaluates to frozen objects", async () => {
    const code = buildPublicEnvCode(state({ declaration: { PUBLIC_NAME: { public: true, static: true } } }), {
      browser: true,
      serverKey: "djs:b1",
    });
    const { env } = (await import(`data:text/javascript,${encodeURIComponent(code)}`)) as { env: Record<string, string> };
    expect(env).toEqual({ PUBLIC_NAME: "Site" });
    expect(Object.isFrozen(env)).toBe(true);
  });
});

describe("missingStatic", () => {
  it("lists static variables without a value; runtime ones may be missing", () => {
    expect(missingStatic(state())).toEqual([]);
    expect(missingStatic(state({ values: { API_KEY: "x" } }))).toEqual(["BUILD_FLAG", "PUBLIC_NAME"]);
  });
});

describe("loadEnvState", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-env-"));
    await writeFile(join(root, "package.json"), '{ "type": "module" }');
    await mkdir(join(root, "src"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads src/env.ts and every .env variable for the mode", async () => {
    await writeFile(join(root, "src/env.ts"), "export const variables = { A: {}, PUBLIC_B: { public: true } };\n");
    await writeFile(join(root, ".env"), "A=1\nPUBLIC_B=2\nOTHER=3\n");
    await writeFile(join(root, ".env.production"), "A=prod\n");

    const loaded = await loadEnvState(root, "production");
    expect(loaded.path).toBe(join(root, "src/env.ts"));
    expect(loaded.declaration).toEqual({ A: {}, PUBLIC_B: { public: true } });
    expect(loaded.values).toMatchObject({ A: "prod", PUBLIC_B: "2", OTHER: "3" });
    expect(loaded.dependencies).toContain(join(root, "src/env.ts"));
  });

  it("works without a declaration", async () => {
    const loaded = await loadEnvState(root, "development");
    expect(loaded.path).toBeNull();
    expect(loaded.declaration).toEqual({});
  });

  it("insists on a `variables` export", async () => {
    await writeFile(join(root, "src/env.ts"), "export const vars = {};\n");
    await expect(loadEnvState(root, "development")).rejects.toThrow(/must export `variables`/);
  });
});

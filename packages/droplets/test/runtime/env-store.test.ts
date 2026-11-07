import { afterEach, describe, expect, it } from "vitest";
import { readRuntimeEnv, setRuntimeEnv } from "../../src/runtime/env-store.ts";

afterEach(() => {
  setRuntimeEnv(undefined);
  delete process.env["DROPLETS_TEST_VAR"];
});

describe("runtime env", () => {
  it("falls back to process.env", () => {
    process.env["DROPLETS_TEST_VAR"] = "from-process";
    expect(readRuntimeEnv("DROPLETS_TEST_VAR")).toBe("from-process");
  });

  it("prefers the values an adapter set, and only returns strings", () => {
    process.env["DROPLETS_TEST_VAR"] = "from-process";
    setRuntimeEnv({ DROPLETS_TEST_VAR: "from-binding", KV: { get() {} } });
    expect(readRuntimeEnv("DROPLETS_TEST_VAR")).toBe("from-binding");
    expect(readRuntimeEnv("KV")).toBeUndefined();
    expect(readRuntimeEnv("MISSING")).toBeUndefined();
  });

  it("keeps its values on globalThis, so every copy of the module agrees", () => {
    setRuntimeEnv({ SHARED: "yes" });
    const store = (globalThis as Record<symbol, { values?: Record<string, unknown> }>)[
      Symbol.for("droplets.env")
    ];
    expect(store?.values).toEqual({ SHARED: "yes" });
  });
});

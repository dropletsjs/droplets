import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoadEvent } from "../../src/runtime/server.ts";

const leaky = () => {
  throw new Error("connect ECONNREFUSED db.internal:5432 (user=shop)");
};

/** entry-server over a registry of these droplets, fresh per test. */
async function entryServer(droplets: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock("virtual:droplets", async (original) => ({ ...(await original<object>()), default: droplets }));
  return import("../../src/runtime/entry-server.ts");
}

const failing = {
  component: {},
  error: {},
  serverLoad: async () => ({ load: leaky }),
};

afterEach(() => {
  vi.doUnmock("virtual:droplets");
  vi.unstubAllEnvs();
});

describe("entry-server: the registry", () => {
  it("finds droplets by id only, never prototype members", async () => {
    const { getDropletMeta } = await entryServer({ hello: { component: {} } });
    expect(getDropletMeta("hello").exists).toBe(true);
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(getDropletMeta(id).exists, id).toBe(false);
    }
  });
});

describe("entry-server: a failed load without handleError", () => {
  it("shows only Internal Error in production: the cause stays in the log", async () => {
    vi.stubEnv("DEV", false);
    const { loadDropletData } = await entryServer({ failing });
    expect(await loadDropletData("failing", {} as LoadEvent)).toEqual({
      failed: true,
      error: { name: "DropletRenderError", message: "Internal Error" },
    });
  });

  it("shows the message in dev", async () => {
    vi.stubEnv("DEV", true);
    const { loadDropletData } = await entryServer({ failing });
    expect(await loadDropletData("failing", {} as LoadEvent)).toEqual({
      failed: true,
      error: { name: "Error", message: "connect ECONNREFUSED db.internal:5432 (user=shop)" },
    });
  });

  it("shows what the droplet's own handleError chose, in production too", async () => {
    vi.stubEnv("DEV", false);
    const { loadDropletData } = await entryServer({
      failing: { ...failing, serverLoad: async () => ({ load: leaky, handleError: () => ({ error: { message: "Try later" } }) }) },
    });
    expect(await loadDropletData("failing", {} as LoadEvent)).toEqual({ failed: true, error: { message: "Try later" } });
  });
});

describe("entry-server: finding a form action", () => {
  const add = async () => ({ added: true });

  it("finds an action by its own name, and says when there are none", async () => {
    const { findAction } = await entryServer({
      shop: { component: {}, serverLoad: async () => ({ actions: { default: add, "add-item": add } }) },
      plain: { component: {}, serverLoad: async () => ({ load: () => ({}) }) },
      bare: { component: {} },
    });
    expect(await findAction("shop", "default")).toBe(add);
    expect(await findAction("shop", "add-item")).toBe(add);
    expect(await findAction("plain", "default")).toBe("none");
    expect(await findAction("bare", "default")).toBe("none");
    expect(await findAction("unknown", "default")).toBe("none");
  });

  it("never reaches a prototype member, an inherited key or a name outside the pattern", async () => {
    const inherited = Object.assign(Object.create({ secret: add }) as object, {});
    const { findAction } = await entryServer({
      shop: { component: {}, serverLoad: async () => ({ actions: { default: add, data: { not: "a function" } } }) },
      bare: { component: {}, serverLoad: async () => ({ actions: Object.assign(Object.create(null) as object, { default: add }) }) },
      sneaky: { component: {}, serverLoad: async () => ({ actions: inherited }) },
    });
    for (const name of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty", "valueOf", "", "1x", "a.b", "a b", "data"]) {
      expect(await findAction("shop", name), name).toBe("missing");
    }
    expect(await findAction("bare", "default")).toBe(add);
    await expect(findAction("sneaky", "secret")).rejects.toThrow(/plain object/);
  });

  it("refuses actions that are not a plain object: a class instance, an array, a function", async () => {
    class Registry {
      default = add;
    }
    for (const actions of [new Registry(), [add], add, "default"]) {
      const { findAction } = await entryServer({ shop: { component: {}, serverLoad: async () => ({ actions }) } });
      await expect(findAction("shop", "default")).rejects.toThrow(/plain object/);
    }
  });
});

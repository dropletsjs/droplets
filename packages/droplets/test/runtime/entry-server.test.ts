import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeadline } from "../../src/runtime/render-timeout.ts";
import type { LoadEvent } from "../../src/runtime/server.ts";

const leaky = () => {
  throw new Error("connect ECONNREFUSED db.internal:5432 (user=shop)");
};

/** entry-server over a registry of these droplets, fresh per test. */
type EntryServerInput = { droplets: Record<string, unknown> };

async function entryServer({ droplets }: EntryServerInput): Promise<typeof import("../../src/runtime/entry-server.ts")> {
  vi.resetModules();
  vi.doMock("virtual:droplets", async (original) => ({ ...(await original<object>()), default: droplets }));
  return import("../../src/runtime/entry-server.ts");
}

/** A load event with a request, as the app hands it. */
const loadEvent = () => ({ request: new Request("http://drops.test/droplets/failing") }) as LoadEvent;

const failing = {
  component: async () => ({}),
  error: async () => ({}),
  serverLoad: async () => ({ load: leaky }),
};

afterEach(() => {
  vi.doUnmock("virtual:droplets");
  vi.unstubAllEnvs();
});

describe("entry-server: the registry", () => {
  it("finds droplets by id only, never prototype members", async () => {
    const { getDropletMeta } = await entryServer({ droplets: { hello: { component: {} } } });
    expect(getDropletMeta("hello").exists).toBe(true);
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(getDropletMeta(id).exists, id).toBe(false);
    }
  });
});

describe("entry-server: a failed load without handleError", () => {
  it("shows only Internal Error in production: the cause stays in the log", async () => {
    vi.stubEnv("DEV", false);
    const { loadDropletData } = await entryServer({ droplets: { failing } });
    expect(await loadDropletData("failing", loadEvent())).toEqual({
      failed: true,
      error: { name: "DropletRenderError", message: "Internal Error" },
    });
  });

  it("shows the message in dev", async () => {
    vi.stubEnv("DEV", true);
    const { loadDropletData } = await entryServer({ droplets: { failing } });
    expect(await loadDropletData("failing", loadEvent())).toEqual({
      failed: true,
      error: { name: "Error", message: "connect ECONNREFUSED db.internal:5432 (user=shop)" },
    });
  });

  it("shows what the droplet's own handleError chose, in production too", async () => {
    vi.stubEnv("DEV", false);
    const { loadDropletData } = await entryServer({
      droplets: {
        failing: { ...failing, serverLoad: async () => ({ load: leaky, handleError: () => ({ error: { message: "Try later" } }) }) },
      },
    });
    expect(await loadDropletData("failing", loadEvent())).toEqual({ failed: true, error: { message: "Try later" } });
  });
});

describe("entry-server: a load that fails past render.timeout", () => {
  it("is rethrown as it is: no console.error, no handleError, from the render and the server load alike", async () => {
    const deadline = createDeadline({ timeout: 0 });
    await new Promise((resolve) => deadline.signal.addEventListener("abort", resolve));
    const event = { request: new Request("http://drops.test/droplets/failing", { signal: deadline.signal }), props: {} } as LoadEvent;
    const handleError = vi.fn(() => ({ error: { message: "Try later" } }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("aborted by the deadline");
    const load = () => {
      throw cause;
    };
    const { loadDropletData, renderDroplet } = await entryServer({
      droplets: { failing: { ...failing, serverLoad: async () => ({ load, handleError }) } },
    });
    await expect(loadDropletData("failing", event)).rejects.toBe(cause);
    await expect(renderDroplet("failing", event)).rejects.toBe(cause);
    expect(logged).not.toHaveBeenCalled();
    expect(handleError).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("entry-server: finding a form action", () => {
  const add = async () => ({ added: true });

  it("finds an action by its own name, and says when there are none", async () => {
    const { findAction } = await entryServer({
      droplets: {
        shop: { component: {}, serverLoad: async () => ({ actions: { default: add, "add-item": add } }) },
        plain: { component: {}, serverLoad: async () => ({ load: () => ({}) }) },
        bare: { component: {} },
      },
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
      droplets: {
        shop: { component: {}, serverLoad: async () => ({ actions: { default: add, data: { not: "a function" } } }) },
        bare: { component: {}, serverLoad: async () => ({ actions: Object.assign(Object.create(null) as object, { default: add }) }) },
        sneaky: { component: {}, serverLoad: async () => ({ actions: inherited }) },
      },
    });
    for (const name of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty", "valueOf", "", "1x", "a.b", "a b", "data"]) {
      expect(await findAction("shop", name), name).toBe("missing");
    }
    expect(await findAction("bare", "default")).toBe(add);
    await expect(findAction("sneaky", "secret")).rejects.toThrow(/plain object/);
  });

  it("refuses actions that are not a plain object: a class instance, an array, a function", async () => {
    // A class: its instance is what `findAction` must refuse.
    class Registry {
      default = add;
    }
    for (const actions of [new Registry(), [add], add, "default"]) {
      const { findAction } = await entryServer({ droplets: { shop: { component: {}, serverLoad: async () => ({ actions }) } } });
      await expect(findAction("shop", "default")).rejects.toThrow(/plain object/);
    }
  });
});

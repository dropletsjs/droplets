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

describe("entry-server: entries", () => {
  type WithEntriesInput = { entries: unknown };

  const withEntries = ({ entries }: WithEntriesInput) =>
    entryServer({ droplets: { testimonials: { component: async () => ({}), serverLoad: async () => ({ entries: () => entries }) } } });

  it("takes an entry's file, and leaves it out when it is undefined", async () => {
    const { getEntries } = await withEntries({
      entries: [{ props: { page: 2 }, file: "page-2" }, { props: { page: 3 }, file: undefined }, { file: "a1-b2-c3" }],
    });
    expect(await getEntries("testimonials")).toEqual([
      { props: { page: 2 }, file: "page-2" },
      { props: { page: 3 } },
      { props: {}, file: "a1-b2-c3" },
    ]);
  });

  it("refuses a file that is not lowercase kebab-case, naming the droplet and the value", async () => {
    for (const [file, shown] of [
      ["Page-2", '"Page-2"'],
      ["page_2", '"page_2"'],
      ["page--2", '"page--2"'],
      ["-a", '"-a"'],
      ["a-", '"a-"'],
      ["", '""'],
      ["a/b", '"a/b"'],
      ["../x", '"../x"'],
      ["page-2.html", '"page-2.html"'],
      [2, "2"],
      [null, "null"],
    ] as const) {
      const { getEntries } = await withEntries({ entries: [{ props: {}, file }] });
      await expect(getEntries("testimonials"), String(file)).rejects.toThrow(
        `an entry's file is a lowercase kebab-case name, got ${shown}`,
      );
    }
  });

  it("refuses two entries with the same file", async () => {
    const { getEntries } = await withEntries({
      entries: [
        { props: { page: 1 }, file: "page" },
        { props: { page: 2 }, file: "page" },
      ],
    });
    await expect(getEntries("testimonials")).rejects.toThrow('two entries name the file "page"');
  });

  it("names file in the shape of an event, and every message the droplet and its code", async () => {
    const cases: Array<[unknown, string, string]> = [
      [{ props: {} }, "entries-not-array", "entries() must return an array of events"],
      [[{ page: 1 }], "entry-shape-invalid", 'entries() returns events, { props?, host?, file? }; got {"page":1}'],
      [[{ props: [] }], "entry-props-not-object", "an entry's props must be an object, got []"],
      [[{ host: "/docs" }], "entry-host-invalid", 'an entry\'s host must be an absolute URL, got "/docs"'],
    ];
    for (const [entries, code, message] of cases) {
      const { getEntries } = await withEntries({ entries });
      const thrown = await getEntries("testimonials").catch((error: unknown) => error);
      expect(thrown, code).toMatchObject({ code });
      expect((thrown as Error).message, code).toContain(message);
      expect((thrown as Error).message, code).toContain("testimonials");
    }
  });
});

describe("entry-server: load's result in its wire form", () => {
  const renderer = { render: () => "<p>x</p>" };
  const event = () =>
    ({ request: new Request("http://drops.test/droplets/card"), props: {}, host: new URL("https://shop.test/") }) as LoadEvent;
  type CardInput = { load?: (event: { data: unknown }) => unknown };
  const card = ({ load }: CardInput) => ({
    component: async () => ({}),
    renderer,
    error: async () => ({}),
    serverLoad: async () => ({ load: () => ({ who: "Ana", at: new Date(0) }) }),
    load: async () => (load ? { load } : { props: {} }),
  });

  it("encodes load's result when the render is asked for it, its transported values listed", async () => {
    const { renderDroplet } = await entryServer({ droplets: { card: card({ load: ({ data }) => ({ data, seen: new Set([1]) }) }) } });
    const result = await renderDroplet("card", event(), { encodeData: true });
    expect(result?.failed).toBeUndefined();
    expect(result?.hasLoad).toBeUndefined();
    expect(result?.dataWire).toEqual({
      value: { data: { who: "Ana", at: "1970-01-01T00:00:00.000Z" }, seen: [1] },
      transported: [
        [["data", "at"], "Date"],
        [["seen"], "Set"],
      ],
    });
  });

  it("leaves load's result unchecked when it is not asked for: a function in it still renders", async () => {
    const { renderDroplet } = await entryServer({ droplets: { card: card({ load: ({ data }) => ({ data, format: () => "x" }) }) } });
    const result = await renderDroplet("card", event());
    expect(result?.failed).toBeUndefined();
    expect(result?.html).toBe("<p>x</p>");
    expect(result?.dataWire).toBeUndefined();
  });

  it("answers a load result the payload contract refuses with the error page, naming the path", async () => {
    vi.stubEnv("DEV", true);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { renderDroplet } = await entryServer({ droplets: { card: card({ load: ({ data }) => ({ data, format: () => "x" }) }) } });
    const result = await renderDroplet("card", event(), { encodeData: true });
    expect(result?.failed).toBe(true);
    expect(String((result?.error as { message?: string } | undefined)?.message)).toContain("load result");
    expect(String((result?.error as { message?: string } | undefined)?.message)).toContain("format");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("gives the server data's wire form as load's without a load, and says so", async () => {
    const { renderDroplet, loadDropletData } = await entryServer({ droplets: { card: card({}) } });
    const result = await renderDroplet("card", event());
    expect(result?.hasLoad).toBe(false);
    expect(result?.dataWire).toBe(result?.serverWire);
    expect(await loadDropletData("card", event())).toMatchObject({ hasLoad: false });
    const { loadDropletData: withLoad } = await entryServer({ droplets: { card: card({ load: ({ data }) => data }) } });
    expect(await withLoad("card", event())).not.toHaveProperty("hasLoad");
  });
});

// @vitest-environment happy-dom
/**
 * Script droplets in the browser: the element runs `+droplet.script.ts`'s
 * default export through the built-in renderer with `(data, el)`, the
 * cleanup it returns runs when the element leaves, every element gets its
 * own `el`, and a script that throws is logged without taking the others down.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ComponentModule } from "../../src/renderer.ts";
import * as scriptClient from "../../src/script/client.ts";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

type EntryClient = typeof import("../../src/runtime/entry-client.ts");
let mod: EntryClient;

beforeAll(async () => {
  (globalThis as Record<symbol, unknown>)[Symbol.for("droplets.servers")] = {
    "djs-droplet:test01": { origin: "http://drops.test" },
  };
  // Two script droplets in the registry stub, both hydrating at once (the default).
  const registry = (await import("virtual:droplets")) as unknown as Record<string, Record<string, unknown>>;
  const byId = registry["dropletsById"] ?? expect.unreachable("dropletsById");
  const hydrateById = registry["dropletsHydrateById"] ?? expect.unreachable("dropletsHydrateById");
  for (const id of ["tracker", "broken"]) {
    byId[id] = true;
    hydrateById[id] = true;
  }
  mod = await import("../../src/runtime/entry-client.ts");
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/**
 * What `/droplets/<id>/client.js` is for a script droplet: the generated
 * entry of `createClientModuleCode` around the built-in renderer, reduced
 * to what the element calls.
 */
type ClientModuleInput = { component: ComponentModule };

function clientModule({ component }: ClientModuleInput) {
  return {
    default: async (target: HTMLElement, data: unknown, children: unknown, info: { renderId?: string } = {}) => {
      const context = {
        droplet: "tracker",
        kind: "droplet" as const,
        children: children as never,
        renderId: info.renderId ?? "fresh1",
        markers: () => [],
        actionUrl: () => "",
      };
      const render = target.childNodes.length > 0 ? scriptClient.hydrate : scriptClient.mount;
      return { engine: scriptClient, instance: await render(component, target, { data }, context) };
    },
    unmount: (handle: { engine: typeof scriptClient; instance: unknown } | null) => handle?.engine.unmount(handle.instance),
  };
}

/** The fragment the server answers for a script droplet: the payloads and an empty content root. */
type FragmentInput = { id: string; data: unknown };

const fragment = ({ id, data }: FragmentInput) =>
  `<djs-droplet data-droplet="${id}" data-build="test01">` +
  `<script type="application/text" data-droplet-context>${encode({ host: "http://page.test/", props: {} })}</script>` +
  `<script type="application/text" data-droplet-data>${encode({ data })}</script>` +
  `<div style="display: contents" data-droplet-entry></div></djs-droplet>`;

type PlaceInput = { html: string };

function place({ html }: PlaceInput): HTMLElement[] {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return Array.from(wrapper.children) as HTMLElement[];
}

type EntryOfInput = { element: Element };

const entryOf = ({ element }: EntryOfInput) =>
  element.querySelector<HTMLElement>(":scope > [data-droplet-entry]") ?? expect.unreachable("the content root");

describe("a script droplet in the browser", () => {
  it("runs the default export with the load's data and the element's content root", async () => {
    const run = vi.fn((data: { views: number }, el: HTMLElement) => {
      el.innerHTML = `<p class="views">${data.views} views</p>`;
    });
    mod.DjsDropletElement.importModule = vi.fn(async () => clientModule({ component: { default: run } })) as never;
    const [element = expect.unreachable("a droplet element")] = place({ html: fragment({ id: "tracker", data: { views: 3 } }) });
    await tick();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toEqual({ views: 3 });
    expect(run.mock.calls[0]?.[1]).toBe(entryOf({ element }));
    expect(element.querySelector(".views")?.textContent).toBe("3 views");
  });

  it("runs the cleanup it returned when the element leaves, then empties the element", async () => {
    const cleanup = vi.fn();
    const run = vi.fn((_data: unknown, el: HTMLElement) => {
      el.append(document.createElement("canvas"));
      return cleanup;
    });
    mod.DjsDropletElement.importModule = vi.fn(async () => clientModule({ component: { default: run } })) as never;
    const [element = expect.unreachable("a droplet element")] = place({ html: fragment({ id: "tracker", data: {} }) });
    await tick();
    expect(cleanup).not.toHaveBeenCalled();
    expect(entryOf({ element }).children).toHaveLength(1);

    element.remove();
    await tick();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(entryOf({ element }).childNodes).toHaveLength(0);
  });

  it("keeps running when the element only moves within one task", async () => {
    const cleanup = vi.fn();
    mod.DjsDropletElement.importModule = vi.fn(async () => clientModule({ component: { default: () => cleanup } })) as never;
    const [element = expect.unreachable("a droplet element")] = place({ html: fragment({ id: "tracker", data: {} }) });
    await tick();
    const other = document.createElement("section");
    document.body.appendChild(other);
    other.appendChild(element);
    await tick();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("gives every element on the page its own el, and its own run", async () => {
    const seen: HTMLElement[] = [];
    const cleanups = [vi.fn(), vi.fn()];
    const run = vi.fn((data: { n: number }, el: HTMLElement) => {
      seen.push(el);
      el.textContent = `instance ${data.n}`;
      return cleanups[data.n];
    });
    mod.DjsDropletElement.importModule = vi.fn(async () => clientModule({ component: { default: run } })) as never;
    const [first = expect.unreachable("the first element"), second = expect.unreachable("the second element")] = place({
      html: fragment({ id: "tracker", data: { n: 0 } }) + fragment({ id: "tracker", data: { n: 1 } }),
    });
    await tick();

    expect(run).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([entryOf({ element: first }), entryOf({ element: second })]);
    expect(entryOf({ element: first }).textContent).toBe("instance 0");
    expect(entryOf({ element: second }).textContent).toBe("instance 1");

    second.remove();
    await tick();
    expect(cleanups[1]).toHaveBeenCalledTimes(1);
    expect(cleanups[0]).not.toHaveBeenCalled();
    expect(entryOf({ element: first }).textContent).toBe("instance 0");
  });

  it("logs a script that throws, and the other droplets on the page still run", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = vi.fn((_data: unknown, el: HTMLElement) => {
      el.textContent = "fine";
    });
    const bad = vi.fn((_data: unknown, el: HTMLElement) => {
      el.textContent = "half done";
      throw new Error("tracker exploded");
    });
    mod.DjsDropletElement.importModule = vi.fn(async (url: string) =>
      clientModule({ component: { default: url.includes("/broken/") ? bad : good } }),
    ) as never;
    const [broken = expect.unreachable("broken"), tracker = expect.unreachable("tracker")] = place({
      html: fragment({ id: "broken", data: {} }) + fragment({ id: "tracker", data: {} }),
    });
    await tick();

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(entryOf({ element: tracker }).textContent).toBe("fine");
    // What the failed run left behind goes; the failure is in the console.
    expect(entryOf({ element: broken }).childNodes).toHaveLength(0);
    expect(error).toHaveBeenCalledWith("[droplets] broken failed", expect.objectContaining({ message: "tracker exploded" }));
  });

  it("says what is wrong with a file that exports no function", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mod.DjsDropletElement.importModule = vi.fn(async () => clientModule({ component: {} })) as never;
    place({ html: fragment({ id: "tracker", data: {} }) });
    await tick();
    expect(error).toHaveBeenCalledWith(
      "[droplets] tracker failed",
      expect.objectContaining({ message: expect.stringContaining("must export a default function (data, el)") }),
    );
  });
});

describe("the script renderer", () => {
  const context = {
    droplet: "tracker",
    kind: "droplet" as const,
    children: { fill: () => {}, empty: () => {} },
    renderId: "r1",
    markers: () => [],
    actionUrl: () => "",
  };

  it("waits for data that is still a promise", async () => {
    const run = vi.fn();
    const target = document.createElement("div");
    await scriptClient.mount({ default: run }, target, { data: Promise.resolve({ ok: true }) }, context);
    expect(run).toHaveBeenCalledWith({ ok: true }, target);
  });

  it("keeps the cleanup of an async script, and empties el even when the cleanup throws", async () => {
    const target = document.createElement("div");
    const cleanup = vi.fn(() => {
      throw new Error("cleanup failed");
    });
    const instance = await scriptClient.mount(
      {
        default: async (_data: unknown, el: HTMLElement) => {
          el.textContent = "x";
          return cleanup;
        },
      },
      target,
      { data: undefined },
      context,
    );
    expect(() => scriptClient.unmount(instance)).toThrow("cleanup failed");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(target.childNodes).toHaveLength(0);
  });

  it("ignores a return value that is not a function", async () => {
    const target = document.createElement("div");
    const instance = await scriptClient.mount({ default: () => 42 }, target, { data: undefined }, context);
    expect(() => scriptClient.unmount(instance)).not.toThrow();
  });
});

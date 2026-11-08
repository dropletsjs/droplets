import { describe, expect, it } from "vitest";
import {
  clampPanel,
  describeMode,
  formatBytes,
  fragmentRequest,
  parseJsonProps,
  parsePanelState,
  propsFromRows,
  propsToQuery,
  propWarnings,
  readToolState,
  rowsFromProps,
  writeToolState,
  type DropletInfo,
} from "../src/shared.ts";

const droplet = (over: Partial<DropletInfo> = {}): DropletInfo => ({
  id: "hello",
  folder: "hello",
  ssr: true,
  hydrate: true,
  hasLoad: false,
  hasServerLoad: false,
  ...over,
});

describe("describeMode", () => {
  it("names each ssr/hydrate combination", () => {
    expect(describeMode(droplet()).label).toBe("SSR + hydrate");
    expect(describeMode(droplet({ hydrate: false })).label).toBe("Static HTML");
    expect(describeMode(droplet({ ssr: false })).label).toBe("Client render");
    const empty = describeMode(droplet({ ssr: false, hydrate: false }));
    expect(empty.label).toBe("Empty");
    expect(empty.empty).toBe(true);
  });

  it("says when a lazy droplet hydrates", () => {
    const visible = describeMode(droplet({ hydrate: "visible" }));
    expect(visible.label).toBe("SSR + hydrate (visible)");
    expect(visible.detail).toContain("about to scroll into view");
    expect(describeMode(droplet({ hydrate: "interactive" })).detail).toContain("first interaction");
  });

  it("mentions inlined data only when there is a server load", () => {
    expect(describeMode(droplet({ ssr: false, hasServerLoad: true })).detail).toContain("inlined");
    expect(describeMode(droplet({ ssr: false })).detail).not.toContain("inlined");
  });
});

describe("props", () => {
  it("encode as a query string, non-strings as JSON", () => {
    expect(propsToQuery({ who: "Ana B", n: 2, tags: ["a"], "": "skip" })).toBe(
      "who=Ana+B&n=2&tags=%5B%22a%22%5D",
    );
  });

  it("round-trip through builder rows", () => {
    const rows = rowsFromProps({ who: "Ana", n: 2 });
    expect(rows).toEqual([{ key: "who", value: "Ana" }, { key: "n", value: "2" }]);
    expect(propsFromRows([...rows, { key: "  ", value: "x" }, { key: " who ", value: "Bo" }])).toEqual({
      who: "Bo",
      n: "2",
    });
  });

  it("parse JSON objects and explain anything else", () => {
    expect(parseJsonProps("")).toEqual({ ok: true, props: {} });
    expect(parseJsonProps('{"a":1}')).toEqual({ ok: true, props: { a: 1 } });
    expect(parseJsonProps("[1]")).toMatchObject({ ok: false });
    expect(parseJsonProps("null")).toMatchObject({ ok: false });
    expect(parseJsonProps("{oops")).toMatchObject({ ok: false });
  });

  it("warn about reserved keys and typed values over GET", () => {
    expect(propWarnings({ who: "x" }, "GET")).toEqual([]);
    expect(propWarnings({ n: 1 }, "POST")).toEqual([]);
    expect(propWarnings({ n: 1 }, "GET")[0]).toMatch(/GET sends every value as text/);
    expect(propWarnings({ c: "1", noSSR: "" }, "POST")[0]).toMatch(/^c, noSSR are reserved/);
  });
});

describe("fragmentRequest", () => {
  it("puts props in the query for GET and in a JSON body for POST", () => {
    expect(fragmentRequest("hello world", "GET", { who: "A" })).toEqual({
      url: "/droplets/hello%20world?who=A",
      init: { method: "GET" },
    });
    expect(fragmentRequest("hello", "GET", {}).url).toBe("/droplets/hello");
    const post = fragmentRequest("hello", "POST", { n: 1 });
    expect(post.url).toBe("/droplets/hello");
    expect(post.init.method).toBe("POST");
    expect(JSON.parse(String(post.init.body))).toEqual({ props: { n: 1 } });
  });
});

describe("tool state in the URL", () => {
  const list = [droplet({ id: "a" }), droplet({ id: "b" })];

  it("round-trips", () => {
    const state = { droplet: "b", method: "POST" as const, mode: "json" as const, props: { n: 1 } };
    expect(readToolState(writeToolState(state), list)).toEqual(state);
  });

  it("falls back to the first droplet and defaults", () => {
    expect(readToolState("?droplet=gone&props=%7Bbad", list)).toEqual({
      droplet: "a",
      method: "GET",
      mode: "builder",
      props: {},
    });
    expect(readToolState("", []).droplet).toBeNull();
    expect(writeToolState({ droplet: null, method: "GET", mode: "builder", props: {} })).toBe("");
  });
});

describe("floating panel", () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 360, height: 600 };

  it("stays inside the viewport", () => {
    expect(clampPanel({ x: -50, y: -10, collapsed: false }, size, viewport)).toEqual({ x: 12, y: 12, collapsed: false });
    expect(clampPanel({ x: 5000, y: 5000, collapsed: true }, size, viewport)).toEqual({ x: 628, y: 740, collapsed: true });
    expect(clampPanel({ x: 300, y: 200, collapsed: false }, size, viewport)).toMatchObject({ x: 300, y: 200 });
  });

  it("reads stored state, ignoring junk", () => {
    expect(parsePanelState('{"x":10,"y":20,"collapsed":true}')).toEqual({ x: 10, y: 20, collapsed: true });
    expect(parsePanelState('{"x":"a"}')).toBeNull();
    expect(parsePanelState("{nope")).toBeNull();
    expect(parsePanelState(null)).toBeNull();
  });
});

it("formats sizes", () => {
  expect(formatBytes(840)).toBe("840 B");
  expect(formatBytes(1300)).toBe("1.3 kB");
});

import { describe, expect, it } from "vitest";
import {
  createExternalMatcher,
  namedExternals,
  readClientExternal,
} from "../../src/vite/client-external.ts";

describe("readClientExternal", () => {
  it("reads the client environment and the top-level build", () => {
    expect(
      readClientExternal({
        build: { rolldownOptions: { external: ["top"] } },
        environments: { client: { build: { rolldownOptions: { external: /^ag-/ } } } },
      }),
    ).toEqual([["top"], /^ag-/]);
    expect(readClientExternal({})).toEqual([]);
  });

  it("ignores other environments", () => {
    expect(
      readClientExternal({ environments: { ssr: { build: { rolldownOptions: { external: ["x"] } } } } }),
    ).toEqual([]);
  });
});

describe("createExternalMatcher", () => {
  it("matches strings, regexes, lists and functions like Rolldown", () => {
    const isExternal = createExternalMatcher([
      "ag-grid-community",
      [/^@big\//, "lodash"],
      (id) => id.startsWith("chart."),
    ]);
    expect(isExternal?.("ag-grid-community")).toBe(true);
    expect(isExternal?.("ag-grid-community/styles")).toBe(false);
    expect(isExternal?.("@big/thing")).toBe(true);
    expect(isExternal?.("lodash")).toBe(true);
    expect(isExternal?.("chart.js")).toBe(true);
    expect(isExternal?.("svelte")).toBe(false);
  });

  it("is null without externals", () => {
    expect(createExternalMatcher([])).toBeNull();
  });
});

it("namedExternals keeps plain names for optimizeDeps.exclude", () => {
  expect(namedExternals(["a", [/^b/, "c"], /d/, () => true])).toEqual(["a", "c"]);
});

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkImportMap, installedVersion, versionInUrl } from "../../src/vite/importmap-check.ts";

const root = fileURLToPath(new URL("../fixtures/app/", import.meta.url));

describe("versionInUrl", () => {
  it.each([
    ["https://cdn.jsdelivr.net/npm/ag-grid-community@34.1.0/+esm", "ag-grid-community", "34.1.0"],
    ["https://esm.sh/@scope/pkg@1.2.3-beta.1", "@scope/pkg", "1.2.3-beta.1"],
    ["https://cdn.test/ag-grid.js", "ag-grid", null],
  ])("%s", (url, name, version) => {
    expect(versionInUrl({ url, name })).toBe(version);
  });
});

it("installedVersion looks up node_modules like Node", () => {
  expect(installedVersion({ root, name: "case-anything" })).toMatch(/^\d+\.\d+\.\d+/);
  expect(installedVersion({ root, name: "definitely-not-installed" })).toBeNull();
});

describe("checkImportMap", () => {
  it("says what is unmapped, unused or mismatched", () => {
    const installed = installedVersion({ root, name: "case-anything" });
    const warnings = checkImportMap({
      map: {
        imports: {
          "case-anything": "https://cdn.test/npm/case-anything@0.0.1/+esm",
          "/@id/case-anything": "https://cdn.test/npm/case-anything@0.0.1/+esm",
          "not-external": "https://cdn.test/x.js",
        },
      },
      externals: ["case-anything", "ag-grid"],
      root,
    });
    expect(warnings.map(({ message, params }) => ({ code: message.code, params }))).toEqual([
      { code: "import-map-external-unmapped", params: { name: "ag-grid" } },
      { code: "import-map-version-mismatch", params: { name: "case-anything", wanted: "0.0.1", installed } },
      { code: "import-map-entry-unused", params: { name: "not-external" } },
    ]);
  });

  it("is quiet when everything lines up", () => {
    const installed = installedVersion({ root, name: "case-anything" });
    expect(
      checkImportMap({
        map: { imports: { "case-anything": `https://cdn.test/case-anything@${installed}` } },
        externals: ["case-anything"],
        root,
      }),
    ).toEqual([]);
  });
});

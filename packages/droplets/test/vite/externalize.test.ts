import { describe, expect, it } from "vitest";
import { withViteIdAliases } from "../../src/vite/externalize.ts";

describe("withViteIdAliases", () => {
  it("adds /@id/ twins for bare specifiers only", () => {
    expect(
      withViteIdAliases({
        importMap: {
          "ag-grid": "https://cdn.test/ag.js",
          "/@id/already": "https://cdn.test/a.js",
          "./relative": "https://cdn.test/r.js",
          "https://cdn.test/x.js": "https://cdn.test/y.js",
        },
      }),
    ).toEqual({
      "ag-grid": "https://cdn.test/ag.js",
      "/@id/ag-grid": "https://cdn.test/ag.js",
      "/@id/already": "https://cdn.test/a.js",
      "./relative": "https://cdn.test/r.js",
      "https://cdn.test/x.js": "https://cdn.test/y.js",
    });
  });

  it("passes undefined through", () => {
    expect(withViteIdAliases({ importMap: undefined })).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { loadHeaders, storedHeaders } from "../../src/runtime/load-headers.ts";

describe("setHeaders", () => {
  it("collects headers, lowercased, in order", () => {
    const { setHeaders, headers } = loadHeaders("card");
    setHeaders({ "Cache-Control": "public, max-age=60" });
    setHeaders({ ETag: '"v1"' });
    expect([...headers]).toEqual([
      ["cache-control", "public, max-age=60"],
      ["etag", '"v1"'],
    ]);
  });

  it("refuses a header set twice, in any case", () => {
    const { setHeaders } = loadHeaders("card");
    setHeaders({ "cache-control": "no-cache" });
    expect(() => setHeaders({ "Cache-Control": "public" })).toThrow(/card: setHeaders: Cache-Control is already set/);
  });

  it("refuses set-cookie: cookies go through cookies", () => {
    const { setHeaders, headers } = loadHeaders("card");
    expect(() => setHeaders({ "Set-Cookie": "a=1" })).toThrow(/cannot set set-cookie/);
    expect(headers.has("set-cookie")).toBe(false);
  });

  it("refuses line breaks and NUL in values: no header injection", () => {
    const { setHeaders, headers } = loadHeaders("card");
    for (const value of ["a\r\nset-cookie: x=1", "a\nb", "a\rb", "a\0b"]) {
      expect(() => setHeaders({ "x-note": value }), JSON.stringify(value)).toThrow(/without line breaks/);
    }
    expect([...headers]).toEqual([]);
  });

  it("refuses names that are not header names, and non-string values", () => {
    const { setHeaders } = loadHeaders("card");
    for (const name of ["", "bad name", "x:y", "x\r\ny", "ü"]) {
      expect(() => setHeaders({ [name]: "v" }), JSON.stringify(name)).toThrow(/is not a header name/);
    }
    expect(() => setHeaders({ "x-n": 1 as unknown as string })).toThrow(/must be a string/);
    expect(() => setHeaders(null as unknown as Record<string, string>)).toThrow(/takes an object/);
    expect(() => setHeaders([["a", "b"]] as unknown as Record<string, string>)).toThrow(/takes an object/);
  });

  it("treats a __proto__ key as a header name like any other: nothing is polluted", () => {
    const { setHeaders, headers } = loadHeaders("card");
    setHeaders(JSON.parse('{"__proto__": "x"}') as Record<string, string>);
    expect(headers.get("__proto__")).toBe("x");
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});

describe("storedHeaders", () => {
  it("keeps valid string headers only, never set-cookie", () => {
    expect(storedHeaders({ "Cache-Control": "public", "set-cookie": "a=1", "x-bad": "a\r\nb", "bad name": "v", n: 1 })).toEqual([
      ["cache-control", "public"],
    ]);
    for (const value of [undefined, null, "x", ["a"]]) expect(storedHeaders(value)).toEqual([]);
  });
});

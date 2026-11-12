import { describe, expect, it } from "vitest";
import { plainJson } from "../../src/runtime/plain-json.ts";

describe("plainJson", () => {
  it("copies plain data, dropping __proto__ keys at every level and keeping Object.prototype", () => {
    const parsed: unknown = JSON.parse('{"a":1,"__proto__":{"polluted":1},"list":[{"__proto__":{"x":1},"b":"two"}],"n":null,"t":true}');
    const copy = plainJson({ value: parsed }) as Record<string, unknown>;
    expect(copy).toEqual({ a: 1, list: [{ b: "two" }], n: null, t: true });
    expect(copy).not.toBe(parsed);
    expect(Object.hasOwn(copy, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Object.getPrototypeOf((copy["list"] as unknown[])[0])).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("makes null-prototype objects on request", () => {
    const copy = plainJson({ value: { a: { b: 1 } }, nullPrototype: true }) as Record<string, unknown>;
    expect(Object.getPrototypeOf(copy)).toBeNull();
    expect(Object.getPrototypeOf(copy["a"])).toBeNull();
    expect(copy).toEqual({ a: { b: 1 } });
  });

  it("refuses what JSON.parse could not have produced, and nesting past 64 levels", () => {
    for (const value of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      () => 1,
      Symbol("s"),
      new Date(),
      new Map(),
      { a: new Date() },
      [1, () => 1],
    ]) {
      expect(plainJson({ value })).toBeUndefined();
    }
    const nest = (depth: number): unknown => (depth === 0 ? 1 : [nest(depth - 1)]);
    expect(plainJson({ value: nest(64) })).toEqual(nest(64));
    expect(plainJson({ value: nest(65) })).toBeUndefined();
    expect(plainJson({ value: JSON.parse(`${"[".repeat(5000)}1${"]".repeat(5000)}`) })).toBeUndefined();
  });
});

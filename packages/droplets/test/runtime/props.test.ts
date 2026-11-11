import { describe, expect, it } from "vitest";
import { PropsError, propsKey, validateProps } from "../../src/runtime/props.ts";

/** The smallest Standard Schema: `page` coerced from a string to a number. */
const pageSchema = {
  "~standard": {
    version: 1 as const,
    vendor: "test",
    validate: async (value: unknown) => {
      const page = Number((value as { page?: unknown }).page);
      return Number.isInteger(page) ? { value: { page } } : { issues: [{ message: "Expected number", path: [{ key: "page" }] }] };
    },
  },
};

describe("validateProps", () => {
  it("passes props through without a schema", async () => {
    const props = { a: 1 };
    expect(await validateProps("d", undefined, props)).toBe(props);
  });

  it("returns the schema's output, coercions included", async () => {
    expect(await validateProps("d", pageSchema, { page: "2" })).toEqual({ page: 2 });
  });

  it("throws a 400 PropsError listing the issues", async () => {
    const failure = await validateProps("d", pageSchema, { page: "x" }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PropsError);
    expect((failure as PropsError).status).toBe(400);
    expect((failure as PropsError).message).toBe("Invalid props: page: Expected number");
  });

  it("refuses something that is not a Standard Schema", async () => {
    await expect(validateProps("d", { parse() {} }, {})).rejects.toThrow(/Standard Schema/);
  });

  it("refuses a schema whose output is not an object", async () => {
    const schema = { "~standard": { version: 1 as const, vendor: "t", validate: () => ({ value: 3 }) } };
    await expect(validateProps("d", schema, {})).rejects.toThrow(/produce an object/);
  });
});

describe("propsKey", () => {
  it("does not depend on key order, at any depth", () => {
    expect(propsKey({ b: 1, a: { d: 2, c: 3 } })).toBe(propsKey({ a: { c: 3, d: 2 }, b: 1 }));
    expect(propsKey({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("keeps array order", () => {
    expect(propsKey({ a: [2, 1] })).not.toBe(propsKey({ a: [1, 2] }));
  });

  it("keeps a __proto__ key as a key: it neither vanishes nor sets a prototype", () => {
    const own = JSON.parse('{"__proto__":{"page":1}}') as Record<string, unknown>;
    expect(propsKey(own)).toBe('{"__proto__":{"page":1}}');
    expect(propsKey(own)).not.toBe(propsKey({}));
    expect(propsKey(JSON.parse('{"a":{"__proto__":{"x":1}}}'))).toBe('{"a":{"__proto__":{"x":1}}}');
    expect(Object.prototype).not.toHaveProperty("page");
  });
});

import { describe, expect, it } from "vitest";
import {
  encodePayload,
  isPayloadContractError,
  type PayloadContractError,
  type PayloadTransport,
  wireEnvelope,
} from "../../src/runtime/payload-encode.server.ts";

type RefusedInput = { value: unknown };

/** The contract error `value` throws, as server data. */
function refused({ value }: RefusedInput): PayloadContractError {
  try {
    encodePayload({ value, what: "server data", droplet: "shop" });
  } catch (error) {
    if (isPayloadContractError(error)) return error;
    throw error;
  }
  return expect.unreachable("a contract error");
}

describe("encodePayload", () => {
  it("leaves plain JSON as it is, with an empty table", () => {
    const value = { a: 1, b: ["x", true, null], c: { d: -1.5 } };
    const encoded = encodePayload({ value, what: "server data" });
    expect(encoded).toEqual({ value, transported: [] });
    expect(encoded.value).not.toBe(value);
    expect(encodePayload({ value: undefined, what: "server data" })).toEqual({ value: undefined, transported: [] });
  });

  it("encodes the built-ins in place and lists them inner values first", () => {
    const value = {
      at: new Date("2026-01-02T03:04:05.000Z"),
      tags: new Map<unknown, unknown>([
        ["a", new Set([new URL("https://shop.example/a")])],
        [{ k: 1 }, 2n],
      ]),
      list: [new Date(0)],
    };
    expect(encodePayload({ value, what: "server data" })).toEqual({
      value: {
        at: "2026-01-02T03:04:05.000Z",
        tags: [
          ["a", ["https://shop.example/a"]],
          [{ k: 1 }, "2"],
        ],
        list: ["1970-01-01T00:00:00.000Z"],
      },
      transported: [
        [["at"], "Date"],
        [["tags", 0, 1, 0], "URL"],
        [["tags", 0, 1], "Set"],
        [["tags", 1, 1], "BigInt"],
        [["tags"], "Map"],
        [["list", 0], "Date"],
      ],
    });
  });

  it("drops an undefined property and an own __proto__ key, writes -0 as 0, and copies shared references", () => {
    const shared = { n: 1 };
    const value = JSON.parse('{"__proto__": {"polluted": true}, "keep": 1}') as Record<string, unknown>;
    value["gone"] = undefined;
    value["zero"] = -0;
    value["a"] = shared;
    value["b"] = shared;
    const encoded = encodePayload({ value, what: "server data" }).value as Record<string, unknown>;
    expect(Object.keys(encoded)).toEqual(["keep", "zero", "a", "b"]);
    expect(Object.is(encoded["zero"], 0)).toBe(true);
    expect(encoded["a"]).toEqual({ n: 1 });
    expect(encoded["a"]).not.toBe(encoded["b"]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("refuses what cannot travel, naming the path and the reason", () => {
    const cycle: Record<string, unknown> = { items: [] };
    (cycle["items"] as unknown[]).push({ back: cycle });
    const holey: number[] = [];
    holey[1] = 2;
    const deep = Array.from({ length: 70 }).reduce<unknown>((inner) => ({ inner }), 1);
    const cases: Array<[unknown, string]> = [
      [{ f: () => 1 }, "f is a function"],
      [{ s: Symbol("x") }, "s is a symbol"],
      [{ k: new (class Thing {})() }, "k is a Thing with no transport"],
      [{ m: new (class Money extends Map {})() }, "m is a Money with no transport"],
      [{ p: Promise.resolve(1) }, "p is a promise: await it in the load"],
      [{ list: [1, undefined] }, "list[1] is undefined"],
      [{ list: holey }, "list[0] is a hole in a sparse array"],
      [{ n: Number.NaN }, "n is NaN"],
      [{ n: Number.POSITIVE_INFINITY }, "n is Infinity"],
      [{ when: new Date(Number.NaN) }, "when is an invalid Date"],
      [{ own: { toJSON: () => "x" } }, "own is an object with its own toJSON"],
      [cycle, "items[0].back is a cycle"],
      [{ "odd key": { e: new Error("x") } }, '["odd key"].e is an Error with no transport'],
      [deep, "nested deeper than 64 levels"],
    ];
    for (const [value, text] of cases) {
      const error = refused({ value });
      expect(error.message, text).toContain(text);
      expect(error.message, text).toContain("droplets error payload-not-serializable");
      expect(error.message, text).toContain("the server data cannot travel to the browser");
      expect(error.code).toBe("payload-not-serializable");
    }
    expect(refused({ value: () => 1 }).path).toBe("the value itself");
  });

  it("takes a shared reference that is no cycle", () => {
    const shared = { n: 1 };
    expect(encodePayload({ value: { a: [shared, shared] }, what: "server data" }).value).toEqual({ a: [{ n: 1 }, { n: 1 }] });
  });

  it("tries the transports it is given before the built-ins, and walks what they return", () => {
    class Money extends Map<string, number> {}
    const money: PayloadTransport = {
      name: "Money",
      encode: (value) => value instanceof Money && { cents: value.get("cents"), at: new Date(0) },
    };
    const encoded = encodePayload({ value: { total: new Money([["cents", 250]]) }, what: "load result", transports: [money] });
    expect(encoded).toEqual({
      value: { total: { cents: 250, at: "1970-01-01T00:00:00.000Z" } },
      transported: [
        [["total", "at"], "Date"],
        [["total"], "Money"],
      ],
    });
    const self: PayloadTransport = { name: "Self", encode: (value) => value };
    expect(() => encodePayload({ value: { a: {} }, what: "load result", transports: [self] })).toThrow(/a cycle/);
  });
});

describe("wireEnvelope", () => {
  it("roots each part's table at its key, and leaves transported out when empty", () => {
    const data = encodePayload({ value: { at: new Date(0) }, what: "server data" });
    const form = encodePayload({ value: { tags: new Set(["a"]) }, what: "action result" });
    expect(wireEnvelope({ parts: { data, form } })).toEqual({
      data: { at: "1970-01-01T00:00:00.000Z" },
      form: { tags: ["a"] },
      transported: [
        [["data", "at"], "Date"],
        [["form", "tags"], "Set"],
      ],
    });
    const plain = wireEnvelope({
      fields: { type: "success", status: 200 },
      parts: { data: encodePayload({ value: { a: 1 }, what: "action result" }) },
    });
    expect(JSON.stringify(plain)).toBe('{"type":"success","status":200,"data":{"a":1}}');
    expect(JSON.stringify(wireEnvelope({ parts: { data: { value: undefined, transported: [] }, form: undefined } }))).toBe("{}");
  });
});

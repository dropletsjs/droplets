import { describe, expect, it } from "vitest";
import { decodePayload, type PayloadDecoder } from "../../src/runtime/payload-decode.ts";
import { encodePayload, wireEnvelope } from "../../src/runtime/payload-encode.server.ts";

type WireInput = { value: unknown };

/** An envelope as the browser gets it: encoded on the server, through JSON. */
function wire({ value }: WireInput): Record<string, unknown> {
  const data = encodePayload({ value, what: "server data" });
  return JSON.parse(JSON.stringify(wireEnvelope({ parts: { data } }))) as Record<string, unknown>;
}

describe("decodePayload", () => {
  it("turns every transported value back, nested, and takes the table off", () => {
    const value = {
      at: new Date("2026-01-02T03:04:05.000Z"),
      tags: new Map<unknown, unknown>([["a", new Set([new URL("https://shop.example/a"), 7n])]]),
      plain: { n: 1, list: [new Date(0), "x"] },
    };
    const decoded = decodePayload({ envelope: wire({ value }) });
    expect(Object.keys(decoded)).toEqual(["data"]);
    const data = decoded["data"] as typeof value;
    expect(data).toEqual(value);
    expect(data.at).toBeInstanceOf(Date);
    const set = data.tags.get("a") as Set<unknown>;
    expect([...set][0]).toBeInstanceOf(URL);
    expect([...set][1]).toBe(7n);
    expect(data.plain.list[0]).toBeInstanceOf(Date);
  });

  it("leaves an envelope without a table as it is", () => {
    const envelope = { data: { at: "1970-01-01T00:00:00.000Z" }, form: { ok: true } };
    expect(decodePayload({ envelope })).toBe(envelope);
    expect(envelope.data.at).toBe("1970-01-01T00:00:00.000Z");
  });

  it("decodes the form as well as the data", () => {
    const form = encodePayload({ value: { at: new Date(0) }, what: "action result" });
    const envelope = JSON.parse(JSON.stringify(wireEnvelope({ parts: { data: { value: { a: 1 }, transported: [] }, form } })));
    expect((decodePayload({ envelope })["form"] as { at: unknown }).at).toEqual(new Date(0));
  });

  it("decodes the server payload's data under server", () => {
    const server = encodePayload({ value: { tags: new Set(["a"]) }, what: "server data" });
    const envelope = JSON.parse(JSON.stringify(wireEnvelope({ parts: { server } })));
    expect(envelope.transported).toEqual([[["server", "tags"], "Set"]]);
    expect((decodePayload({ envelope })["server"] as { tags: unknown }).tags).toEqual(new Set(["a"]));
  });

  it("refuses a table it cannot apply, whole", () => {
    const base = () => ({ data: { at: "1970-01-01T00:00:00.000Z", list: ["x"], nested: { deep: "y" } } }) as Record<string, unknown>;
    const tables: Array<[unknown, RegExp]> = [
      ["nope", /not a list/],
      [[[["data", "at"]]], /\[path, name\]/],
      [[["data", "at"]], /path that is not a list/],
      [[[[], "Date"]], /path that is not a list/],
      [[[["data", "at"], 1]], /name that is not a string/],
      [[[["data", "at"], "Money"]], /no transport named "Money"/],
      [[[["data", "at"], "toString"]], /no transport named "toString"/],
      [[[["data", "at"], "__proto__"]], /no transport named "__proto__"/],
      [[[["error"], "Date"]], /outside data, server and form/],
      [[[["transported"], "Set"]], /outside data, server and form/],
      [[[["data", "__proto__"], "Date"]], /key the payload does not have/],
      [[[["data", "constructor"], "Date"]], /key the payload does not have/],
      [[[["data", "missing"], "Date"]], /key the payload does not have/],
      [[[["data", "list", 1], "Date"]], /out of range/],
      [[[["data", "list", "0"], "Date"]], /out of range/],
      [[[["data", "list", -1], "Date"]], /out of range/],
      [[[["data", "at", "x"], "Date"]], /not an object or an array/],
      [[[["data", "list"], "Map"]], /not a list of pairs/],
      [[[["data", "nested"], "Set"]], /not a list/],
      [[[["data", "at"], "BigInt"]], /not an integer/],
      [[[["data", "nested", "deep"], "URL"]], /does not parse/],
      [[[["data", "nested", "deep"], "Date"]], /not an ISO string/],
      // Outer before inner: the inner path runs into a value already decoded.
      [
        [
          [["data", "list"], "Set"],
          [["data", "list", 0], "Date"],
        ],
        /already decoded/,
      ],
      [
        [
          [["data", "at"], "Date"],
          [["data", "at"], "Date"],
        ],
        /not an ISO string/,
      ],
    ];
    for (const [transported, message] of tables) {
      expect(() => decodePayload({ envelope: { ...base(), transported } }), JSON.stringify(transported)).toThrow(message);
    }
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("finds a name only in the decoders it is given", () => {
    const decoders = new Map<string, PayloadDecoder>([["Money", (json) => ({ money: json })]]);
    const envelope = { data: { total: 250 }, transported: [[["data", "total"], "Money"]] };
    expect(decodePayload({ envelope, decoders })).toEqual({ data: { total: { money: 250 } } });
    expect(() => decodePayload({ envelope: { data: { at: "x" }, transported: [[["data", "at"], "Date"]] }, decoders })).toThrow(
      /no transport named "Date"/,
    );
  });
});

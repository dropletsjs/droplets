import { describe, expect, it } from "vitest";
import { formatMessage } from "../../src/errors/format.ts";
import { TRANSPORT_IGNORED } from "../../src/errors/runtime.ts";
import { encodePayload } from "../../src/runtime/payload-encode.server.ts";
import { readTransport } from "../../src/runtime/transport.ts";

const encode = (value: unknown) => (value instanceof Uint8Array ? Array.from(value) : false);
const decode = (json: number[]) => Uint8Array.from(json);

describe("readTransport", () => {
  it("has nothing to read without src/hooks.ts or its transport", () => {
    expect(readTransport(undefined)).toEqual({ entries: [], ignored: [] });
  });

  it("keeps each entry of two functions, by its name, in order", () => {
    const read = readTransport({ Bytes: { encode, decode }, Other: { encode, decode } });
    expect(read.entries.map(({ name }) => name)).toEqual(["Bytes", "Other"]);
    expect(read.entries[0]?.encode).toBe(encode);
    expect(read.entries[0]?.decode).toBe(decode);
    expect(read.ignored).toEqual([]);
  });

  it("ignores an entry named like a built-in: the built-in wins", () => {
    const read = readTransport({ Date: { encode, decode }, Map: { encode, decode }, Bytes: { encode, decode } });
    expect(read.entries.map(({ name }) => name)).toEqual(["Bytes"]);
    expect(read.ignored).toEqual([
      { name: "Date", reason: "builtin-name" },
      { name: "Map", reason: "builtin-name" },
    ]);
  });

  it("ignores an entry that is not a plain object with encode and decode functions of its own", () => {
    const inherited = Object.create({ encode, decode }) as object;
    const read = readTransport({
      Half: { encode },
      Strings: { encode: "x", decode: "y" },
      Fn: encode,
      Inherited: inherited,
      Null: null,
      Listed: [encode, decode],
      Bytes: { encode, decode },
    });
    expect(read.entries.map(({ name }) => name)).toEqual(["Bytes"]);
    expect(read.ignored.map(({ name }) => name)).toEqual(["Half", "Strings", "Fn", "Inherited", "Null", "Listed"]);
    expect(new Set(read.ignored.map(({ reason }) => reason))).toEqual(new Set(["not-functions"]));
  });

  it.each([null, "Money", 1, [{ encode, decode }], new Map([["Bytes", { encode, decode }]]), () => ({})])(
    "ignores a transport that is not a plain object: %s",
    (transport) => {
      expect(readTransport(transport)).toEqual({ entries: [], ignored: [{ name: null, reason: "not-object" }] });
    },
  );

  it("takes a null-prototype object as a plain one", () => {
    const transport = Object.assign(Object.create(null) as object, { Bytes: { encode, decode } });
    expect(readTransport(transport).entries.map(({ name }) => name)).toEqual(["Bytes"]);
  });

  it("says why under the dev warning, naming the entry", () => {
    const text = (name: string | null, reason: "not-object" | "builtin-name" | "not-functions") =>
      formatMessage({ message: TRANSPORT_IGNORED, params: { name, reason } });
    expect(text("Date", "builtin-name")).toContain('transport entry "Date" of src/hooks.ts is ignored: Date is a built-in, which wins');
    expect(text("Half", "not-functions")).toContain("it is not an object with encode and decode functions");
    expect(text(null, "not-object")).toContain("transport of src/hooks.ts is not a plain object");
  });
});

describe("the encoder with the entries of transport", () => {
  it("runs them before the built-ins, so a subclass of Map travels by its own name", () => {
    // A class of the app's own, the case a transport is for.
    class Tally extends Map<string, number> {}
    const { entries } = readTransport({
      Tally: { encode: (value: unknown) => value instanceof Tally && [...value], decode: (json: never) => json },
    });
    const transports = entries.map(({ name, encode: encodeEntry }) => ({ name, encode: encodeEntry }));
    const encoded = encodePayload({ value: { votes: new Tally([["yes", 2]]), when: new Date(0) }, what: "server data", transports });
    expect(encoded.value).toEqual({ votes: [["yes", 2]], when: "1970-01-01T00:00:00.000Z" });
    expect(encoded.transported).toEqual([
      [["votes"], "Tally"],
      [["when"], "Date"],
    ]);
  });

  it("never runs an ignored entry: a Date stays the built-in's", () => {
    const { entries } = readTransport({ Date: { encode: () => "the author's", decode } });
    const transports = entries.map(({ name, encode: encodeEntry }) => ({ name, encode: encodeEntry }));
    expect(encodePayload({ value: new Date(0), what: "server data", transports }).transported).toEqual([[[], "Date"]]);
  });
});

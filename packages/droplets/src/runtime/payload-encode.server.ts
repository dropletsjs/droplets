/**
 * The server side of the payload contract: what a droplet sends the browser
 * (its server data, an action's result) is plain JSON plus the values a
 * transport carries (`Date`, `Map`, `Set`, `URL`, `BigInt`, nested), checked
 * on every render and encoded to its wire form (`payload-wire.ts`). The
 * server never decodes: what a request carries stays plain data.
 *
 * @module
 */
import { formatMessage } from "../errors/format.ts";
import { PAYLOAD_NOT_SERIALIZABLE } from "../errors/runtime.ts";
import { type Encoded, MAX_PAYLOAD_DEPTH, type PathSegment, TRANSPORTED_KEY, type TransportedEntry } from "./payload-wire.ts";

/**
 * A transport the encoder tries: `encode` returns the value's JSON form, or
 * `false` when the value is not its own. Tried in order, before the
 * built-ins match by exact prototype.
 */
export type PayloadTransport = { name: string; encode: (value: unknown) => unknown };

/** What travels: names the payload in a contract error. */
export type PayloadKind = "server data" | "load result" | "action result";

const CONTRACT = Symbol.for("droplets.payload-contract");

type PayloadContractErrorInput = { what: PayloadKind; path: string; reason: string; droplet?: string | undefined };

/** A value the payload contract refuses, with where it is and why. Recognised by brand across bundles. */
export class PayloadContractError extends Error {
  readonly [CONTRACT] = true;
  readonly code = PAYLOAD_NOT_SERIALIZABLE.code;
  readonly path: string;
  readonly reason: string;

  constructor({ what, path, reason, droplet }: PayloadContractErrorInput) {
    super(formatMessage({ message: PAYLOAD_NOT_SERIALIZABLE, params: { what, path, reason }, droplet }));
    this.name = "PayloadContractError";
    this.path = path;
    this.reason = reason;
  }
}

export function isPayloadContractError(value: unknown): value is PayloadContractError {
  return typeof value === "object" && value !== null && CONTRACT in value;
}

type BuiltinCodec = { name: string; prototype: object; encode: (value: never) => unknown };

/** By exact prototype: a subclass needs a transport of its own. */
const BUILTINS: readonly BuiltinCodec[] = [
  { name: "Date", prototype: Date.prototype, encode: (value: Date) => value.toISOString() },
  { name: "Map", prototype: Map.prototype, encode: (value: Map<unknown, unknown>) => Array.from(value, ([key, item]) => [key, item]) },
  { name: "Set", prototype: Set.prototype, encode: (value: Set<unknown>) => Array.from(value) },
  { name: "URL", prototype: URL.prototype, encode: (value: URL) => value.href },
];

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

type PathTextInput = { path: readonly PathSegment[] };

/** `items[0].when`, `["a b"]`: where a value sits, as code would reach it. */
function pathText({ path }: PathTextInput): string {
  if (path.length === 0) return "the value itself";
  return path
    .map((segment, index) => {
      if (typeof segment === "number") return `[${segment}]`;
      if (!IDENTIFIER.test(segment)) return `[${JSON.stringify(segment)}]`;
      return index === 0 ? segment : `.${segment}`;
    })
    .join("");
}

type ClassNameInput = { value: object };

function className({ value }: ClassNameInput): string {
  const name: unknown = (Object.getPrototypeOf(value) as { constructor?: { name?: unknown } } | null)?.constructor?.name;
  return typeof name === "string" && name !== "" ? name : "object";
}

function isPromiseLike(value: object): boolean {
  return typeof (value as { then?: unknown }).then === "function";
}

export type EncodePayloadInput = {
  value: unknown;
  what: PayloadKind;
  droplet?: string | undefined;
  /** Tried before the built-ins, in order. */
  transports?: readonly PayloadTransport[] | undefined;
};

/**
 * `value` in its wire form: a fresh JSON tree, and where its transported
 * values are, inner ones first. Throws `PayloadContractError` naming the
 * path for anything the contract refuses: a cycle (shared references are
 * copied, not refused), a function or a symbol, a class instance no
 * transport takes, a promise, `undefined` or a hole in an array, a
 * non-finite number or an invalid `Date`, an own `toJSON`, nesting past 64
 * levels. An `undefined` property and an own `__proto__` key are left out;
 * `-0` becomes `0`.
 */
export function encodePayload({ value, what, droplet, transports = [] }: EncodePayloadInput): Encoded {
  const transported: TransportedEntry[] = [];
  const ancestors = new Set<object>();
  const path: PathSegment[] = [];
  const refuse = (reason: string): never => {
    throw new PayloadContractError({ what, path: pathText({ path }), reason, droplet });
  };

  function walk(current: unknown, depth: number): unknown {
    if (depth > MAX_PAYLOAD_DEPTH) return refuse(`nested deeper than ${MAX_PAYLOAD_DEPTH} levels`);
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) return refuse(`${current}, a number JSON cannot carry`);
      return Object.is(current, -0) ? 0 : current;
    }
    if (typeof current === "bigint") return carried("BigInt", current.toString(), depth);
    if (current === undefined) return refuse("undefined, which only an object property may be (it is left out)");
    if (typeof current === "function") return refuse("a function");
    if (typeof current === "symbol") return refuse("a symbol");
    const object = current as object;
    if (ancestors.has(object)) return refuse("a cycle: it holds itself");
    ancestors.add(object);
    try {
      for (const transport of transports) {
        const json = transport.encode(object);
        if (json !== false) return carried(transport.name, json, depth);
      }
      const proto: unknown = Object.getPrototypeOf(object);
      if (proto === Array.prototype) return array(object as unknown[], depth);
      if (proto === Object.prototype || proto === null) return plain(object as Record<string, unknown>, depth);
      for (const codec of BUILTINS) {
        if (proto !== codec.prototype) continue;
        if (codec.name === "Date" && Number.isNaN((object as Date).getTime())) return refuse("an invalid Date");
        return carried(codec.name, codec.encode(object as never), depth);
      }
      if (isPromiseLike(object)) return refuse("a promise: await it in the load");
      const name = className({ value: object });
      return refuse(`${/^[AEIOU]/i.test(name) ? "an" : "a"} ${name} with no transport`);
    } finally {
      ancestors.delete(object);
    }
  }

  // The JSON form is walked like any value (a Map's entries may hold
  // dates), then listed after what it holds.
  function carried(name: string, json: unknown, depth: number): unknown {
    const encoded = walk(json, depth + 1);
    transported.push([[...path], name]);
    return encoded;
  }

  function array(items: unknown[], depth: number): unknown[] {
    const copy: unknown[] = [];
    for (let index = 0; index < items.length; index += 1) {
      path.push(index);
      if (!(index in items)) refuse("a hole in a sparse array");
      copy.push(walk(items[index], depth + 1));
      path.pop();
    }
    return copy;
  }

  function plain(object: Record<string, unknown>, depth: number): Record<string, unknown> {
    if (Object.hasOwn(object, "toJSON") && typeof object["toJSON"] === "function") {
      return refuse("an object with its own toJSON");
    }
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(object)) {
      if (key === "__proto__") continue;
      const item = object[key];
      if (item === undefined) continue;
      path.push(key);
      copy[key] = walk(item, depth + 1);
      path.pop();
    }
    return copy;
  }

  return { value: value === undefined ? undefined : walk(value, 0), transported };
}

export type WireEnvelopeInput = {
  /** Fields as they are (`type`, `status`): plain by construction. */
  fields?: Record<string, unknown>;
  /** Encoded parts by key (`data`, `form`): their tables join, rooted at the envelope. */
  parts: Record<string, Encoded | undefined>;
};

/**
 * The envelope as it goes out: `fields`, each part's tree under its key,
 * and `transported` when any part has a transported value. Without one,
 * exactly what plain JSON would be.
 */
export function wireEnvelope({ fields = {}, parts }: WireEnvelopeInput): Record<string, unknown> {
  const envelope: Record<string, unknown> = { ...fields };
  const transported: TransportedEntry[] = [];
  for (const [key, part] of Object.entries(parts)) {
    if (part === undefined) continue;
    envelope[key] = part.value;
    for (const [path, name] of part.transported) transported.push([[key, ...path], name]);
  }
  if (transported.length > 0) envelope[TRANSPORTED_KEY] = transported;
  return envelope;
}

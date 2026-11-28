/**
 * The browser side of the payload contract: an envelope's `transported`
 * table turned back into the values it lists, over the tree `JSON.parse`
 * made of a payload this page's own server sent. Only the browser decodes;
 * no server module imports this one.
 *
 * @module
 */
import { FORBIDDEN_SEGMENTS, MAX_PAYLOAD_DEPTH, type PathSegment, TRANSPORTED_KEY } from "./payload-wire.ts";

/** Turns a transported value's JSON form back into the value; throws when the form is not its own. */
export type PayloadDecoder = (json: unknown) => unknown;

/** The envelope keys a transported value may sit under. */
const PAYLOAD_KEYS: ReadonlySet<string> = new Set(["data", "server", "form"]);

const INTEGER = /^-?(?:0|[1-9]\d*)$/;

/** Thrown for an envelope whose table cannot be applied: the whole payload is unreadable. */
export class PayloadDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadDecodeError";
  }
}

function fail(message: string): never {
  throw new PayloadDecodeError(message);
}

/** The built-in decoders, by the name the wire carries. */
export const BUILTIN_DECODERS: ReadonlyMap<string, PayloadDecoder> = new Map<string, PayloadDecoder>([
  [
    "Date",
    (json) => {
      const date = typeof json === "string" ? new Date(json) : null;
      return date && !Number.isNaN(date.getTime()) ? date : fail("a Date that is not an ISO string");
    },
  ],
  [
    "Map",
    (json) =>
      Array.isArray(json) && json.every((entry) => Array.isArray(entry) && entry.length === 2)
        ? new Map(json as Array<[unknown, unknown]>)
        : fail("a Map that is not a list of pairs"),
  ],
  ["Set", (json) => (Array.isArray(json) ? new Set(json) : fail("a Set that is not a list"))],
  [
    "URL",
    (json) => {
      if (typeof json !== "string") return fail("a URL that is not a string");
      try {
        return new URL(json);
      } catch {
        return fail("a URL that does not parse");
      }
    },
  ],
  ["BigInt", (json) => (typeof json === "string" && INTEGER.test(json) ? BigInt(json) : fail("a BigInt that is not an integer"))],
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ChildInput = { container: unknown; segment: unknown };

/** The container and key of one step: own keys of plain objects, in-range indices of arrays, nothing else. */
function step({ container, segment }: ChildInput): { container: Record<string, unknown> | unknown[]; key: PathSegment } {
  if (Array.isArray(container)) {
    if (typeof segment !== "number" || !Number.isInteger(segment) || segment < 0 || segment >= container.length) {
      return fail("a path index out of range");
    }
    return { container, key: segment };
  }
  if (isObject(container)) {
    const proto: unknown = Object.getPrototypeOf(container);
    if (proto !== Object.prototype && proto !== null) return fail("a path through a value already decoded");
    if (typeof segment !== "string" || FORBIDDEN_SEGMENTS.has(segment) || !Object.hasOwn(container, segment)) {
      return fail("a path key the payload does not have");
    }
    return { container, key: segment };
  }
  return fail("a path through a value that is not an object or an array");
}

export type DecodePayloadInput = {
  envelope: Record<string, unknown>;
  /** By name; a name the payload carries reaches a decoder only through this `Map`. */
  decoders?: ReadonlyMap<string, PayloadDecoder>;
};

/**
 * The envelope with every value its `transported` table lists decoded in
 * place, in the table's order (inner values first), and the table taken
 * off. The envelope comes as `JSON.parse` made it and is changed. Throws
 * `PayloadDecodeError` for a table that is not a list of `[path, name]`, a
 * path that leaves the payload's own keys and indices, a name no decoder
 * has, or a value its decoder refuses: the payload is then unreadable.
 */
export function decodePayload({ envelope, decoders = BUILTIN_DECODERS }: DecodePayloadInput): Record<string, unknown> {
  if (!Object.hasOwn(envelope, TRANSPORTED_KEY)) return envelope;
  const table = envelope[TRANSPORTED_KEY];
  delete envelope[TRANSPORTED_KEY];
  if (!Array.isArray(table)) return fail("transported is not a list");
  for (const entry of table) {
    if (!Array.isArray(entry) || entry.length !== 2) return fail("an entry that is not [path, name]");
    const [path, name] = entry as [unknown, unknown];
    if (!Array.isArray(path) || path.length === 0 || path.length > MAX_PAYLOAD_DEPTH + 2) return fail("a path that is not a list");
    if (typeof name !== "string") return fail("a name that is not a string");
    const decoder = decoders.get(name);
    if (!decoder) return fail(`no transport named ${JSON.stringify(name.slice(0, 100))}`);
    const [first] = path as unknown[];
    if (typeof first !== "string" || !PAYLOAD_KEYS.has(first)) return fail("a path outside data, server and form");
    let container: unknown = envelope;
    for (let index = 0; index < path.length - 1; index += 1) {
      const at = step({ container, segment: path[index] });
      container = (at.container as Record<PathSegment, unknown>)[at.key];
    }
    const at = step({ container, segment: path[path.length - 1] });
    const value = decoder((at.container as Record<PathSegment, unknown>)[at.key]);
    Object.defineProperty(at.container, at.key, { value, writable: true, enumerable: true, configurable: true });
  }
  return envelope;
}

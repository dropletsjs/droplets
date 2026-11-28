/**
 * The wire form of what a droplet sends the browser (the fragment's data
 * payload, `_data`, an action's answer), shared by the server's encoder and
 * the browser's decoder: plain JSON, each transported value in its encoded
 * form at its spot, and `transported` on the envelope listing where they
 * are, inner values first. Without one, a payload is plain JSON as it was.
 *
 * @module
 */

/** An object key, or an array index. */
export type PathSegment = string | number;

/** Where a transported value is, from the envelope's root, and the name of its transport. */
export type TransportedEntry = [path: PathSegment[], name: string];

/** A value as it travels: the JSON tree, and where its transported values are, relative to it. */
export type Encoded = { value: unknown; transported: TransportedEntry[] };

/** The envelope's key that lists the transported values. */
export const TRANSPORTED_KEY = "transported";

/** The built-in transports, by the name the wire carries. */
export const BUILTIN_TRANSPORTS = ["Date", "Map", "Set", "URL", "BigInt"] as const;

export type BuiltinTransport = (typeof BUILTIN_TRANSPORTS)[number];

/** Path segments a decoder never walks or writes: the keys of `Object.prototype`'s plumbing. */
export const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/** Deeper than this, a value is no payload: refused, never walked. */
export const MAX_PAYLOAD_DEPTH = 64;

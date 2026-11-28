/**
 * `transport` of `src/hooks.ts`: the project's own types, carried by the
 * payload contract next to the built-ins. Read the same way by the SSR
 * bundle (the encoders) and by `/index.js` (the decoders), so both sides
 * keep and ignore the same entries.
 *
 * @module
 */
import { BUILTIN_TRANSPORTS } from "./payload-wire.ts";

/**
 * The `transport` export of `src/hooks.ts`: by name, how a type of the
 * project travels to the browser. The file runs on the server and in the
 * browser, so it imports nothing of the server; `encode` and `decode` are
 * pure. On the server `encode` gets every object the payload holds, before
 * the built-ins: it returns the value's JSON form (plain JSON, or values
 * another transport carries), or `false` when the value is not its own. In
 * the browser `decode` gets that JSON form back and returns the value.
 * Type `json` as `encode` returns it.
 *
 * ```ts
 * // src/hooks.ts
 * import type { Transport } from "@dropletsjs/droplets";
 * import { Money } from "./lib/money.ts";
 *
 * export const transport: Transport = {
 *   Money: {
 *     encode: (value) => value instanceof Money && { cents: value.cents, currency: value.currency },
 *     decode: (json: { cents: number; currency: string }) => new Money(json.cents, json.currency),
 *   },
 * };
 * ```
 *
 * A name of a built-in (`Date`, `Map`, `Set`, `URL`, `BigInt`), an entry
 * that is not an object with the two functions, or a `transport` that is
 * not a plain object is ignored, with a warning under `vite dev`.
 */
export type Transport = Record<string, { encode: (value: unknown) => unknown; decode: (json: never) => unknown }>;

/** An entry of `transport` both sides use. */
export type TransportEntry = { name: string; encode: (value: unknown) => unknown; decode: (json: unknown) => unknown };

/** Why an entry, or the whole `transport`, is left out. */
export type TransportIgnoredReason = "not-object" | "builtin-name" | "not-functions";

export type IgnoredTransport = { name: string | null; reason: TransportIgnoredReason };

const BUILTIN_NAMES: ReadonlySet<string> = new Set(BUILTIN_TRANSPORTS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * The entries of `transport` (`undefined` without one) that both sides
 * use, in their order, and those left out with why: a built-in's name,
 * an entry that is not a plain object with `encode` and `decode`
 * functions of its own, or all of it when it is not a plain object.
 */
export function readTransport(transport: unknown): { entries: TransportEntry[]; ignored: IgnoredTransport[] } {
  if (transport === undefined) return { entries: [], ignored: [] };
  if (!isPlainObject(transport)) return { entries: [], ignored: [{ name: null, reason: "not-object" }] };
  const entries: TransportEntry[] = [];
  const ignored: IgnoredTransport[] = [];
  for (const name of Object.keys(transport)) {
    const entry = transport[name];
    if (BUILTIN_NAMES.has(name)) {
      ignored.push({ name, reason: "builtin-name" });
      continue;
    }
    if (!isPlainObject(entry) || !Object.hasOwn(entry, "encode") || !Object.hasOwn(entry, "decode")) {
      ignored.push({ name, reason: "not-functions" });
      continue;
    }
    const { encode, decode } = entry;
    if (typeof encode !== "function" || typeof decode !== "function") {
      ignored.push({ name, reason: "not-functions" });
      continue;
    }
    entries.push({ name, encode: encode as TransportEntry["encode"], decode: decode as TransportEntry["decode"] });
  }
  return { entries, ignored };
}

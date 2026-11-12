/** Deeper than this is no render context, form result or props: refused, never walked. */
const MAX_DEPTH = 64;

export type PlainJsonInput = { value: unknown; nullPrototype?: boolean; depth?: number };

/**
 * Plain JSON data, copied: arrays as arrays, objects as fresh objects
 * (`Object.prototype`, or none with `nullPrototype`) without a `__proto__`
 * key, so what the client sent stays data wherever it is read. `undefined`
 * for anything `JSON.parse` could not have produced, a non-finite number,
 * or nesting past 64 levels; nothing is taken on trust.
 */
export function plainJson({ value, nullPrototype = false, depth = 0 }: PlainJsonInput): unknown {
  if (depth > MAX_DEPTH) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      const copy = plainJson({ value: item, nullPrototype, depth: depth + 1 });
      if (copy === undefined) return undefined;
      items.push(copy);
    }
    return items;
  }
  if (typeof value !== "object") return undefined;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return undefined;
  const copy = (nullPrototype ? Object.create(null) : {}) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (key === "__proto__") continue;
    const item = plainJson({ value: (value as Record<string, unknown>)[key], nullPrototype, depth: depth + 1 });
    if (item === undefined) return undefined;
    copy[key] = item;
  }
  return copy;
}

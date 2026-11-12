import { json, type RequestHandler } from "$droplets/server";
import { addToCount, readCount } from "../../lib/server/counter.ts";

/** Larger than any `{ "by": -100 }`; anything bigger is refused unread. */
const MAX_BODY = 64;

/** A plain `{ … }` object, as `JSON.parse` makes: no array, no other prototype. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** `GET /api/counter` -> `{ "count": 3 }`. */
export const GET: RequestHandler = () => json({ count: readCount() });

/**
 * `POST /api/counter` with `{ "by": 2 }` (1 when left out) -> the new
 * `{ "count" }`. The body is plain data: one JSON object (or nothing), and
 * its own `by` field an integer within ±100; anything else is answered 400.
 */
export const POST: RequestHandler = async ({ request }) => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return json({ message: "body too large" }, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ message: "body too large" }, { status: 413 });

  let body: unknown = {};
  try {
    if (text) body = JSON.parse(text);
  } catch {
    return json({ message: "body: JSON" }, { status: 400 });
  }
  if (!isPlainObject(body)) return json({ message: "body: { by }" }, { status: 400 });
  const by = Object.hasOwn(body, "by") ? body["by"] : 1;
  if (!Number.isInteger(by) || Math.abs(by as number) > 100) {
    return json({ message: "by: an integer within ±100" }, { status: 400 });
  }
  return json({ count: addToCount(by as number) });
};

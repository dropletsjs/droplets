import { json, type RequestHandler } from "$droplets/server";
import { addToCount, readCount } from "../../lib/server/counter.ts";

/** `GET /api/counter` -> `{ "count": 3 }`. */
export const GET: RequestHandler = () => json({ count: readCount() });

/** `POST /api/counter` with `{ "by": 2 }` (1 when left out) -> the new `{ "count" }`. */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { by?: unknown };
  const by = Number.isInteger(body.by) && Math.abs(body.by as number) <= 100 ? (body.by as number) : 1;
  return json({ count: addToCount(by) });
};

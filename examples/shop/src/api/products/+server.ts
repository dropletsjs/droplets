import * as z from "zod/mini";
import { json, type RequestHandler } from "$droplets/server";
import { filterFields } from "../../lib/schemas.ts";
import { query } from "../../lib/server/http.ts";
import { listProducts } from "../../lib/server/products.ts";

/** An opaque cursor: the next offset, base64url. A tampered one is a 400, never a crash. */
const encodeCursor = (offset: number) => Buffer.from(`o:${offset}`).toString("base64url");
const decodeCursor = (cursor: string) => {
  const match = /^o:(\d{1,6})$/.exec(Buffer.from(cursor, "base64url").toString());
  return match ? Number(match[1]) : null;
};

const listQuery = z.object({
  ...filterFields,
  limit: z._default(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(48)), 12),
  cursor: z.optional(z.string().check(z.regex(/^[A-Za-z0-9_-]{1,16}$/))),
});

/**
 * `GET /api/products?q=&category=&sort=new|price-asc|price-desc&onSale=1&limit=12&cursor=…`
 * → `{ items: CardProduct[], total, nextCursor }`. Public data: caches may keep it briefly.
 */
export const GET: RequestHandler = async ({ url }) => {
  const { limit, cursor, ...filter } = await query(url, listQuery);
  const offset = cursor === undefined ? 0 : decodeCursor(cursor);
  if (offset === null) return json({ message: "Invalid cursor." }, { status: 400 });
  const { items, total } = await listProducts(filter, offset, limit);
  const next = offset + items.length;
  return json(
    { items, total, nextCursor: next < total ? encodeCursor(next) : null },
    { headers: { "cache-control": "public, max-age=10" } },
  );
};

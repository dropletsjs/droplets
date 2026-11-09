import { error, json, type RequestHandler } from "$droplets/server";
import { stockState } from "../../../lib/format.ts";
import { PRODUCT_ID } from "../../../lib/schemas.ts";
import { productsByIds, salePrice } from "../../../lib/server/catalogue.ts";
import { field, jsonBody } from "../../../lib/server/http.ts";

const MAX_IDS = 50;

/**
 * `POST /api/stock/check` with `{ "ids": ["p_12", …] }` (at most 50) →
 * `{ items: [{ id, stock, stockState, priceCents, salePriceCents }] }`, in
 * the order asked, from WordPress now; ids it no longer publishes are left
 * out. The cart drawer calls it on open.
 */
export const POST: RequestHandler = async ({ request }) => {
  const ids = field(await jsonBody(request), "ids");
  if (!Array.isArray(ids) || ids.length > MAX_IDS) error(400, `"ids": an array of at most ${MAX_IDS} product ids.`);
  if (!ids.every((id): id is string => typeof id === "string" && PRODUCT_ID.test(id))) error(400, `"ids": product ids only.`);
  const unique = [...new Set(ids)];
  const byId = new Map((await productsByIds(unique)).map((product) => [product.id, product]));
  const items = unique.flatMap((id) => {
    const product = byId.get(id);
    if (!product) return [];
    return [{
      id,
      stock: product.stock,
      stockState: stockState(product.stock),
      priceCents: product.priceCents,
      salePriceCents: salePrice(product),
    }];
  });
  return json({ items });
};

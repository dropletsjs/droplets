import { error, json, type RequestHandler } from "$droplets/server";
import { stockState } from "../../../lib/format.ts";
import { PRODUCT_ID } from "../../../lib/schemas.ts";
import { currentCampaign, salePrice } from "../../../lib/server/campaigns.ts";
import { field, jsonBody } from "../../../lib/server/http.ts";
import { productsByIds } from "../../../lib/server/products.ts";

const MAX_IDS = 50;

/**
 * `POST /api/stock/check` with `{ "ids": ["p_…", …] }` (at most 50) →
 * `{ items: [{ id, stock, stockState, priceCents, salePriceCents }] }`, in
 * the order asked, unknown or archived ids left out. The cart drawer calls
 * it on open.
 */
export const POST: RequestHandler = async ({ request }) => {
  const ids = field(await jsonBody(request), "ids");
  if (!Array.isArray(ids) || ids.length > MAX_IDS) error(400, `"ids": an array of at most ${MAX_IDS} product ids.`);
  if (!ids.every((id): id is string => typeof id === "string" && PRODUCT_ID.test(id))) error(400, `"ids": product ids only.`);
  const unique = [...new Set(ids)];
  const [rows, campaign] = await Promise.all([productsByIds(unique), currentCampaign()]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items = unique.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    return [{
      id,
      stock: row.stock,
      stockState: stockState(row.stock),
      priceCents: row.price_cents,
      salePriceCents: salePrice(campaign, id, row.price_cents),
    }];
  });
  return json({ items });
};

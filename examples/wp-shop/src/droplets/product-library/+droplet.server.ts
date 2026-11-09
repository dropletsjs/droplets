import { addToCartAction } from "../../lib/server/forms.ts";
import { listProducts } from "../../lib/server/catalogue.ts";
import type { Actions, LoadEvent } from "./$types";

/** One page of the catalogue, rendered live: stock and prices change all the time. */
export const load = async ({ props }: LoadEvent) => {
  const { q, category, sort, onSale, scope, page, pageSize } = props;
  const filter = { q, category, sort, onSale };
  const { items, total, campaign } = await listProducts(filter, (page - 1) * pageSize, pageSize);
  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    filter: { ...filter, scope },
    campaign: campaign && { name: campaign.name, pct: campaign.pct, endsAt: campaign.endsAt },
  };
};

export const actions = {
  /** `?/add`: productId (+ qty) into the `cart_id` cart. */
  add: addToCartAction,
} satisfies Actions;

import { error, json, type RequestHandler } from "$droplets/server";
import { PRODUCT_ID } from "../../../../lib/schemas.ts";
import { emptyCart, removeFromCart } from "../../../../lib/server/cart.ts";

/** `DELETE /api/cart/items/:productId` → `{ cart }`: the JSON twin of `?/remove`. */
export const DELETE: RequestHandler<{ productId: string }> = async ({ params, locals }) => {
  if (!PRODUCT_ID.test(params.productId)) error(400, "Not a product id.");
  if (!locals.cartId) return json({ cart: emptyCart() });
  return json({ cart: await removeFromCart(locals.cartId, params.productId) });
};

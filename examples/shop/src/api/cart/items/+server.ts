import { error, json, type RequestHandler } from "$droplets/server";
import { PRODUCT_ID } from "../../../lib/schemas.ts";
import { addToCart, CART_COOKIE, CART_COOKIE_OPTIONS, MAX_QTY } from "../../../lib/server/cart.ts";
import { field, jsonBody } from "../../../lib/server/http.ts";

/**
 * `POST /api/cart/items` with `{ "productId": "p_…", "qty": 1 }` → `{ cart }`:
 * the JSON twin of the `?/add` actions, for a host SPA with a cart UI of its
 * own. Creates the cart (and its cookie) on the first add; `409` when the
 * product is sold out or gone. A JSON body from another origin needs a
 * CORS preflight, so a page elsewhere cannot post it with the visitor's
 * cookie.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
  const body = await jsonBody(request, 1024);
  const productId = field(body, "productId");
  const qty = field(body, "qty") ?? 1;
  if (typeof productId !== "string" || !PRODUCT_ID.test(productId)) error(400, `"productId": a product id.`);
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    error(400, `"qty": a whole number from 1 to ${MAX_QTY}.`);
  }
  const result = await addToCart(locals.cartId, productId, qty);
  if (!result.ok) return json({ reason: result.reason }, { status: result.reason === "out" ? 409 : 404 });
  if (result.created) cookies.set(CART_COOKIE, result.cartId, CART_COOKIE_OPTIONS);
  return json({ cart: result.cart });
};

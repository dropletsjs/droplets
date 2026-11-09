import { fail } from "$droplets/server";
import { cartIdFrom, CART_COOKIE, clearCart, MAX_QTY, readCart, removeFromCart, setQty } from "../../lib/server/cart.ts";
import { integer, readForm, text } from "../../lib/server/forms.ts";
import { PRODUCT_ID } from "../../lib/schemas.ts";
import type { Actions, LoadEvent } from "./$types";

/**
 * The cart behind the `cart_id` cookie. Client-only droplet: nothing is
 * rendered on the server, but this load still runs and its result comes
 * inline, so the badge is right as soon as the bundle mounts. Reading never
 * creates a cart.
 */
export const load = async ({ locals, props }: LoadEvent) => ({
  cart: await readCart(locals.cartId),
  variant: props.variant,
});

/** The line an action is about: the cart from the cookie, the product from the form. */
async function line(request: Request, cookie: string | undefined) {
  const cartId = cartIdFrom(cookie);
  const form = await readForm(request);
  const productId = form && text(form, "productId", 40);
  if (!cartId) return { error: fail(400, { reason: "no-cart" as const }) };
  if (!form || !productId || !PRODUCT_ID.test(productId)) return { error: fail(400, { reason: "invalid" as const }) };
  return { cartId, form, productId };
}

export const actions = {
  /** `?/setQty`: productId, qty (0 removes the line). */
  setQty: async ({ request, cookies }) => {
    const found = await line(request, cookies.get(CART_COOKIE));
    if ("error" in found) return found.error;
    const qty = integer(found.form, "qty", 0, MAX_QTY);
    if (qty === null) return fail(400, { reason: "invalid" as const });
    return { cart: await setQty(found.cartId, found.productId, qty) };
  },

  /** `?/remove`: productId. */
  remove: async ({ request, cookies }) => {
    const found = await line(request, cookies.get(CART_COOKIE));
    if ("error" in found) return found.error;
    return { cart: await removeFromCart(found.cartId, found.productId) };
  },

  /** `?/clear`: every line. */
  clear: async ({ cookies }) => {
    const cartId = cartIdFrom(cookies.get(CART_COOKIE));
    if (!cartId) return fail(400, { reason: "no-cart" as const });
    return { cart: await clearCart(cartId) };
  },
} satisfies Actions;

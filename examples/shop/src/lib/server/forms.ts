import { fail, type ActionEvent } from "$droplets/server";
import { PRODUCT_ID } from "../schemas.ts";
import { addToCart, CART_COOKIE, CART_COOKIE_OPTIONS, cartIdFrom, MAX_QTY } from "./cart.ts";

// Reading a form: every field is checked for its type, length and shape;
// nothing from the body is merged into anything. A File where a string is
// expected, or a field over its limit, is a missing field.

export function text(form: FormData, name: string, max: number): string | null {
  const value = form.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : null;
}

/** An integer in `[min, max]`, or `null`. */
export function integer(form: FormData, name: string, min: number, max: number): number | null {
  const value = text(form, name, 12);
  if (value === null || !/^-?\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

/** A form body, or `null` when it cannot be read as one. */
export async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

/**
 * `?/add` of product-library, product-card and product-page: one product,
 * a quantity, the cart cookie. The cart is created on the first add.
 */
export async function addToCartAction({ request, cookies }: ActionEvent) {
  const form = await readForm(request);
  const productId = form && text(form, "productId", 40);
  if (!form || !productId || !PRODUCT_ID.test(productId)) return fail(400, { reason: "invalid" as const });
  const qty = form.get("qty") === null ? 1 : integer(form, "qty", 1, MAX_QTY);
  if (qty === null) return fail(400, { reason: "invalid" as const, productId });

  const result = await addToCart(cartIdFrom(cookies.get(CART_COOKIE)), productId, qty);
  if (!result.ok) return fail(409, { reason: result.reason, productId });
  if (result.created) cookies.set(CART_COOKIE, result.cartId, CART_COOKIE_OPTIONS);
  // The name, for the toast the product page's add is relayed as.
  const name = result.cart.items.find((line) => line.productId === productId)?.name ?? "";
  return { added: productId, name, count: result.cart.count };
}

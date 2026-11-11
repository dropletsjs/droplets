import { randomUUID } from "node:crypto";
import type { Cart, CartLine } from "../types.ts";
import { stockState } from "../format.ts";
import { currentCampaign, salePrice } from "./campaigns.ts";
import { db, now } from "./db.ts";
import { pageVersions } from "./products.ts";

/**
 * The cart lives in the database, keyed by the `cart_id` cookie: a random
 * UUID nobody can guess, HttpOnly, never readable by page scripts. There is
 * no checkout, so nothing reserves stock: adding clamps to what is left.
 */
export const CART_COOKIE = "cart_id";

export const CART_COOKIE_OPTIONS = { path: "/", maxAge: 60 * 60 * 24 * 30, httpOnly: true, sameSite: "lax" } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The cookie's value when it has the shape of a cart id, else `null`. */
export const cartIdFrom = (value: string | undefined | null) => (value && UUID.test(value) ? value : null);

export const MAX_QTY = 20;

export const emptyCart = (): Cart => ({ count: 0, totalCents: 0, currency: "EUR", items: [] });

export async function readCart(cartId: string | null): Promise<Cart> {
  if (!cartId) return emptyCart();
  const [rows, campaign, versions] = await Promise.all([
    db()
      .selectFrom("cart_items")
      .innerJoin("products", "products.id", "cart_items.product_id")
      .select([
        "products.id",
        "products.slug",
        "products.name",
        "products.image",
        "products.price_cents",
        "products.stock",
        "products.status",
        "cart_items.qty",
      ])
      .where("cart_items.cart_id", "=", cartId)
      .orderBy("cart_items.added_at")
      .execute(),
    currentCampaign(),
    pageVersions(),
  ]);
  const items: CartLine[] = rows.map((row) => {
    const sale = salePrice(campaign, row.id, row.price_cents);
    const unit = sale ?? row.price_cents;
    const stock = row.status === "active" ? row.stock : 0;
    const v = versions.get(row.slug);
    return {
      productId: row.id,
      slug: row.slug,
      name: row.name,
      image: row.image,
      qty: row.qty,
      unitCents: unit,
      wasCents: sale === null ? null : row.price_cents,
      lineCents: unit * row.qty,
      stock,
      stockState: stockState(stock),
      ...(v ? { v } : {}),
    };
  });
  return {
    count: items.reduce((n, line) => n + line.qty, 0),
    totalCents: items.reduce((n, line) => n + line.lineCents, 0),
    currency: "EUR",
    items,
  };
}

export type AddResult = { ok: true; cartId: string; created: boolean; cart: Cart } | { ok: false; reason: "missing" | "out" };

/**
 * Adds `qty` of a product, creating the cart when `cartId` is `null` (the
 * caller sets the cookie then). The line never exceeds the stock or MAX_QTY.
 */
export async function addToCart(cartId: string | null, productId: string, qty: number): Promise<AddResult> {
  const product = await db()
    .selectFrom("products")
    .select(["id", "stock"])
    .where("id", "=", productId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!product) return { ok: false, reason: "missing" };
  if (product.stock < 1) return { ok: false, reason: "out" };

  const at = now();
  let id = cartId && (await db().selectFrom("carts").select("id").where("id", "=", cartId).executeTakeFirst())?.id;
  const created = !id;
  if (!id) {
    id = randomUUID();
    await db().insertInto("carts").values({ id, created_at: at, updated_at: at }).execute();
  }
  const line = await db()
    .selectFrom("cart_items")
    .select("qty")
    .where("cart_id", "=", id)
    .where("product_id", "=", productId)
    .executeTakeFirst();
  const want = Math.min((line?.qty ?? 0) + qty, product.stock, MAX_QTY);
  if (line) {
    await db().updateTable("cart_items").set({ qty: want }).where("cart_id", "=", id).where("product_id", "=", productId).execute();
  } else {
    await db().insertInto("cart_items").values({ cart_id: id, product_id: productId, qty: want, added_at: at }).execute();
  }
  await db().updateTable("carts").set({ updated_at: at }).where("id", "=", id).execute();
  return { ok: true, cartId: id, created, cart: await readCart(id) };
}

/** Sets a line's quantity; 0 removes it. Clamped to stock and MAX_QTY. */
export async function setQty(cartId: string, productId: string, qty: number): Promise<Cart> {
  if (qty <= 0) return removeFromCart(cartId, productId);
  const product = await db().selectFrom("products").select("stock").where("id", "=", productId).executeTakeFirst();
  const want = Math.max(1, Math.min(qty, product?.stock ?? 0, MAX_QTY));
  if (!product || product.stock < 1) return removeFromCart(cartId, productId);
  await db().updateTable("cart_items").set({ qty: want }).where("cart_id", "=", cartId).where("product_id", "=", productId).execute();
  return readCart(cartId);
}

export async function removeFromCart(cartId: string, productId: string): Promise<Cart> {
  await db().deleteFrom("cart_items").where("cart_id", "=", cartId).where("product_id", "=", productId).execute();
  return readCart(cartId);
}

export async function clearCart(cartId: string): Promise<Cart> {
  await db().deleteFrom("cart_items").where("cart_id", "=", cartId).execute();
  return readCart(cartId);
}

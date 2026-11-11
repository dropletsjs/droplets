import { randomUUID } from "node:crypto";
import { stockState } from "../format.ts";
import type { Cart, CartLine } from "../types.ts";
import { pageVersions, productById, productsByIds, salePrice } from "./catalogue.ts";
import { db, now } from "./db.ts";

/**
 * The cart lives in wp-shop's SQLite, keyed by the `cart_id` cookie: a
 * random UUID nobody can guess, HttpOnly. Its lines name WordPress
 * products; prices and stock are read from WordPress whenever the cart is.
 * There is no checkout, so nothing reserves stock: adding clamps to what
 * is left.
 */
export const CART_COOKIE = "cart_id";

export const CART_COOKIE_OPTIONS = { path: "/", maxAge: 60 * 60 * 24 * 30, httpOnly: true, sameSite: "lax" } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The cookie's value when it has the shape of a cart id, else `null`. */
export const cartIdFrom = (value: string | undefined | null) => (value && UUID.test(value) ? value : null);

export const MAX_QTY = 20;

export const emptyCart = (): Cart => ({ count: 0, totalCents: 0, currency: "EUR", items: [] });

type Line = { product_id: string; qty: number };

export async function readCart(cartId: string | null): Promise<Cart> {
  if (!cartId) return emptyCart();
  const lines = db().prepare("SELECT product_id, qty FROM cart_items WHERE cart_id = ? ORDER BY added_at").all(cartId) as Line[];
  if (!lines.length) return emptyCart();
  const [products, versions] = await Promise.all([productsByIds(lines.map((line) => line.product_id)), pageVersions()]);
  const byId = new Map(products.map((product) => [product.id, product]));
  // A product WordPress no longer publishes drops out of the cart's view.
  const items: CartLine[] = lines.flatMap((line) => {
    const product = byId.get(line.product_id);
    if (!product) return [];
    const sale = salePrice(product);
    const unit = sale ?? product.priceCents;
    const v = versions.get(product.slug);
    return [
      {
        productId: product.id,
        slug: product.slug,
        name: product.name,
        image: product.image,
        qty: line.qty,
        unitCents: unit,
        wasCents: sale === null ? null : product.priceCents,
        lineCents: unit * line.qty,
        stock: product.stock,
        stockState: stockState(product.stock),
        ...(v ? { v } : {}),
      },
    ];
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
  const product = await productById(productId);
  if (!product) return { ok: false, reason: "missing" };
  if (product.stock < 1) return { ok: false, reason: "out" };

  const at = now();
  const known = cartId && (db().prepare("SELECT id FROM carts WHERE id = ?").get(cartId) as { id: string } | undefined)?.id;
  const id = known || randomUUID();
  if (!known) db().prepare("INSERT INTO carts (id, created_at, updated_at) VALUES (?, ?, ?)").run(id, at, at);
  const line = db().prepare("SELECT qty FROM cart_items WHERE cart_id = ? AND product_id = ?").get(id, productId) as
    | { qty: number }
    | undefined;
  const want = Math.min((line?.qty ?? 0) + qty, product.stock, MAX_QTY);
  db()
    .prepare(
      `INSERT INTO cart_items (cart_id, product_id, qty, added_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (cart_id, product_id) DO UPDATE SET qty = excluded.qty`,
    )
    .run(id, productId, want, at);
  db().prepare("UPDATE carts SET updated_at = ? WHERE id = ?").run(at, id);
  return { ok: true, cartId: id, created: !known, cart: await readCart(id) };
}

/** Sets a line's quantity; 0 removes it. Clamped to stock and MAX_QTY. */
export async function setQty(cartId: string, productId: string, qty: number): Promise<Cart> {
  const product = qty > 0 ? await productById(productId) : undefined;
  if (!product || product.stock < 1) return removeFromCart(cartId, productId);
  const want = Math.max(1, Math.min(qty, product.stock, MAX_QTY));
  db().prepare("UPDATE cart_items SET qty = ? WHERE cart_id = ? AND product_id = ?").run(want, cartId, productId);
  return readCart(cartId);
}

export async function removeFromCart(cartId: string, productId: string): Promise<Cart> {
  db().prepare("DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?").run(cartId, productId);
  return readCart(cartId);
}

export async function clearCart(cartId: string): Promise<Cart> {
  db().prepare("DELETE FROM cart_items WHERE cart_id = ?").run(cartId);
  return readCart(cartId);
}

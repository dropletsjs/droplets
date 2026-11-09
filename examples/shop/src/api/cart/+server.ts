import { json, type RequestHandler } from "$droplets/server";
import { readCart } from "../../lib/server/cart.ts";

/** `GET /api/cart` → `{ cart }` for the `cart_id` cookie; an empty cart without one (none is created). */
export const GET: RequestHandler = async ({ locals }) => json({ cart: await readCart(locals.cartId) });

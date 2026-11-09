import { building } from "$droplets/env";
import { hostFrom, type Handle, type HandleServerError } from "$droplets/server";
import { hostAdmin } from "./lib/server/admin.ts";
import { CART_COOKIE, cartIdFrom } from "./lib/server/cart.ts";
import type { HostAdmin } from "./lib/server/host-identity.ts";

declare module "@dropletsjs/droplets/server" {
  interface Locals {
    /**
     * The WordPress admin behind the request: the plugin's signed
     * `x-wp-shop-user`, checked (lib/server/host-identity.ts). wp-shop has
     * no login of its own.
     */
    admin: HostAdmin | null;
    /** The `cart_id` cookie, when it has a cart id's shape (it may name no cart yet). */
    cartId: string | null;
  }
}

/** Answers about one visitor: never kept by a shared cache. */
const PRIVATE_API = /^\/api\/(?:cart|auth)(?:\/|$)/;

/**
 * Runs for every request, build-time renders included (no headers there).
 * Authorization lives in data: the admin fragment without an admin renders
 * a link to wp-login.php, an admin action answers fail(401). Nothing here
 * redirects: WordPress fetching a fragment must get the fragment.
 */
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.admin = building ? null : await hostAdmin(event.request, event.url);
  event.locals.cartId = building ? null : cartIdFrom(event.cookies.get(CART_COOKIE));

  // WordPress sends its page's URL as Referer: `host` gets the path, so a
  // relative redirect after an action lands where it should.
  if (!building) event.host = hostFrom(event.request.headers.get("referer")) ?? event.host;

  const response = await resolve(event);
  if (event.locals.admin || PRIVATE_API.test(event.url.pathname)) response.headers.set("cache-control", "private, no-store");
  return response;
};

export const handleError: HandleServerError = ({ error, event }) => {
  console.error(`[wp-shop] ${event.request.method} ${event.url.pathname}:`, error);
  return { message: "Something broke in the shop." };
};

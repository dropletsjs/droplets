import { building } from "$droplets/env";
import { hostFrom, type Handle, type HandleServerError, type RequestEvent } from "$droplets/server";
import { ADMIN_COOKIE, type Admin } from "./lib/server/auth.ts";
import { sessionAdmin } from "./lib/server/admin.ts";
import { CART_COOKIE, cartIdFrom } from "./lib/server/cart.ts";

declare module "@dropletsjs/droplets/server" {
  interface Locals {
    /** The admin whose signed `shop_admin` cookie came with the request. */
    admin: Admin | null;
    /** The `cart_id` cookie, when it has a cart id's shape (it may name no cart yet). */
    cartId: string | null;
    /** The host page the request came from (its `Referer`), when it is on the shop's own or a trusted origin. */
    page: URL | null;
  }
}

/** Answers about one visitor: never kept by a shared cache. */
const PRIVATE_API = /^\/api\/(?:cart|auth)(?:\/|$)/;

/**
 * The host page, from the `Referer` a host's server sends with a fragment
 * fetch and a browser with a post. `hostFrom` keeps it within
 * `trustedOrigins` once there is a list, and trusts any origin before one
 * is set: without `DROPLETS_TRUSTED_ORIGINS`, only the shop's own pages
 * count, so a stale product link is never sent on to a stranger's page.
 */
function pageFrom(event: RequestEvent): URL | null {
  const page = hostFrom(event.request.headers.get("referer"));
  if (!page) return null;
  const listed = process.env.DROPLETS_TRUSTED_ORIGINS?.trim();
  return page.origin === event.url.origin || listed ? page : null;
}

/**
 * Runs for every request, build-time renders included (no cookies there).
 * Authorization lives in data: a fragment without a session renders the
 * login gate, an admin action answers fail(401). Nothing here redirects: a
 * host's server fetching a fragment must get the fragment.
 */
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.admin = building ? null : sessionAdmin(event.cookies.get(ADMIN_COOKIE));
  event.locals.cartId = building ? null : cartIdFrom(event.cookies.get(CART_COOKIE));

  // A proxied page posts with its own URL as Referer: `host` gets the path,
  // so a relative redirect after an action lands where it should.
  event.locals.page = building ? null : pageFrom(event);
  event.host = event.locals.page ?? event.host;

  const response = await resolve(event);
  if (PRIVATE_API.test(event.url.pathname)) response.headers.set("cache-control", "private, no-store");
  return response;
};

export const handleError: HandleServerError = ({ error, event }) => {
  console.error(`[shop] ${event.request.method} ${event.url.pathname}:`, error);
  return { message: "Something broke in the shop." };
};

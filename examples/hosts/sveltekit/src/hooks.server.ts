import type { Handle } from "@sveltejs/kit";
import { PROXIED } from "$lib/shop.server.ts";
import { shop } from "$lib/shop-page.server.ts";

/** The basic page's body; the shop's pages style theirs with shop.css. */
const BASIC_BODY = ' style="font-family: system-ui, sans-serif; background: #f8fafc; margin: 0; padding: 2rem;"';

export const handle: Handle = async ({ event, resolve }) => {
  // The shop demo's routes (`/index.js`, `/droplets/*`, `/assets/*`,
  // `/api/*`) go to the shop before any routing, bodies streamed through.
  if (PROXIED.test(event.url.pathname)) return shop.proxy(event.request);

  const isShop = event.route.id?.startsWith("/(shop)") ?? false;
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html.replace("%host.body%", isShop ? ' class="shop"' : BASIC_BODY),
  });
  if (isShop) {
    // Per visitor: the fragments came with the browser's cookies.
    response.headers.set("cache-control", "private, no-store");
    // What the fragments set, passed on untouched (never through
    // `cookies.set`, which would re-encode them).
    for (const cookie of event.locals.shopCookies ?? []) response.headers.append("set-cookie", cookie);
  }
  return response;
};

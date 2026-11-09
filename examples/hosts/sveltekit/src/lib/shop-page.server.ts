import { env } from "$env/dynamic/private";
import { redirect, type RequestEvent } from "@sveltejs/kit";
import { createShop } from "./shop.server.ts";

/** The stack this host is, in the footer: the one thing that differs between hosts. */
export const STACK = "SvelteKit 2";

export const shop = createShop({
  internalUrl: env.SHOP_INTERNAL_URL ?? "http://localhost:8300",
  publicUrl: env.SHOP_PUBLIC_URL ?? "http://localhost:8006",
});

type Redirect = 300 | 301 | 302 | 303 | 304 | 305 | 306 | 307 | 308;

/**
 * Fetches fragments as the browser's request asked: its cookies, this page
 * as the host. Their `Set-Cookie` go to `locals`, for `handle` to put on the
 * page's response untouched; a droplet's redirect is answered as it is.
 */
export async function shopFragments(event: RequestEvent, wanted: [id: string, params: URLSearchParams][]) {
  const page = { path: event.url.pathname + event.url.search, cookie: event.request.headers.get("cookie") };
  const results = await Promise.all(wanted.map(([id, params]) => shop.fragment(page, id, params)));
  (event.locals.shopCookies ??= []).push(...results.flatMap((result) => result.cookies));
  const moved = results.find((result) => result.location);
  if (moved) redirect(moved.status as Redirect, moved.location!);
  return { fragments: results.map((result) => result.html), head: shop.linkTags(results) };
}

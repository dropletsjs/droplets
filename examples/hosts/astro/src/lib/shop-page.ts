import { createShop } from "./shop.ts";

/** The stack this host is, in the footer: the one thing that differs between hosts. */
export const STACK = "Astro 5";

export const shop = createShop({
  internalUrl: process.env.SHOP_INTERNAL_URL ?? "http://localhost:8300",
  publicUrl: process.env.SHOP_PUBLIC_URL ?? "http://localhost:8005",
});

export type ShopPage = Awaited<ReturnType<typeof shopPage>>;

/**
 * Fetches the toasts (first in the body), the header's cart and the page's fragments, as the
 * browser's request asked.
 */
export async function shopPage(request: Request, wanted: [id: string, params: URLSearchParams][]) {
  const url = new URL(request.url);
  const page = { path: url.pathname + url.search, cookie: request.headers.get("cookie") };
  const [toasts, cart, ...fragments] = await Promise.all([
    shop.fragment(page, "toast-center", new URLSearchParams()),
    shop.fragment(page, "shopping-cart", new URLSearchParams({ variant: "badge" })),
    ...wanted.map(([id, params]) => shop.fragment(page, id, params)),
  ]);
  const all = [toasts!, cart!, ...fragments];
  return {
    toasts: toasts!.html,
    cart: cart!.html,
    fragments: fragments.map((fragment) => fragment.html),
    head: shop.linkTags(all),
    cookies: all.flatMap((fragment) => fragment.cookies),
    redirect: all.find((fragment) => fragment.location) ?? null,
  };
}

/**
 * Hands the fragments' `Set-Cookie` to the page's response. A droplet's
 * redirect is answered as it is: the Response to return from the page.
 */
export function finish(astro: { response: { headers: Headers } }, page: ShopPage): Response | null {
  if (page.redirect) {
    const headers = new Headers({ location: page.redirect.location!, "cache-control": "private, no-store" });
    for (const cookie of page.cookies) headers.append("set-cookie", cookie);
    return new Response(null, { status: page.redirect.status, headers });
  }
  astro.response.headers.set("cache-control", "private, no-store");
  for (const cookie of page.cookies) astro.response.headers.append("set-cookie", cookie);
  return null;
}

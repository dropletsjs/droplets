import { shopFragments, STACK } from "$lib/shop-page.server.ts";
import type { LayoutServerLoad } from "./$types";

/**
 * On every shop page: the toasts (first in the layout) and the header's cart badge.
 */
export const load: LayoutServerLoad = async (event) => {
  const { fragments, head } = await shopFragments(event, [
    ["toast-center", new URLSearchParams()],
    ["shopping-cart", new URLSearchParams({ variant: "badge" })],
  ]);
  return { stack: STACK, toasts: fragments[0]!, cart: fragments[1]!, layoutHead: head };
};

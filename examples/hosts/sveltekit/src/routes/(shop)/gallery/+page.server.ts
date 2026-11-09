import { shopFragments } from "$lib/shop-page.server.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  // The whole query to both: the shop drops what a droplet does not take.
  const query = new URLSearchParams(event.url.search);
  const { fragments, head } = await shopFragments(event, [
    ["product-filter", query],
    ["product-library", query],
  ]);
  return { filter: fragments[0]!, library: fragments[1]!, head };
};

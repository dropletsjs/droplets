import { pick } from "$lib/shop.server.ts";
import { shopFragments } from "$lib/shop-page.server.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  const { fragments, head } = await shopFragments(event, [
    ["login", pick(new URLSearchParams(event.url.search), ["next"])],
  ]);
  return { login: fragments[0]!, head };
};

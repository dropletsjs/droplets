import { error } from "@sveltejs/kit";
import { pick } from "$lib/shop.server.ts";
import { shop, shopFragments } from "$lib/shop-page.server.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async (event) => {
  const found = await shop.product(event.params.slug);
  if (!found) error(404, "This product does not exist.");

  const comments = pick(new URLSearchParams(event.url.search), ["order", "page", "showing"]);
  comments.set("productId", found.id);
  // `v`, when the link had one: the shop serves its build's page for the
  // current version and redirects an old one to this URL without it.
  const page = pick(new URLSearchParams(event.url.search), ["v"]);
  page.set("slug", found.slug);
  const { fragments, head } = await shopFragments(event, [
    ["product-page", page],
    ["product-comments", comments],
  ]);
  return {
    product: found,
    categoryHref: `/gallery?${new URLSearchParams({ category: found.category.slug })}`,
    page: fragments[0]!,
    comments: fragments[1]!,
    head,
  };
};

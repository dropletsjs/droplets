import { error } from "$droplets/server";
import { addToCartAction } from "../../lib/server/forms.ts";
import { cardBySlug } from "../../lib/server/catalogue.ts";
import type { Actions, LoadEvent } from "./$types";

export const load = async ({ props }: LoadEvent) => {
  const product = await cardBySlug(props.slug);
  if (!product) error(404, "No such product.");
  return { product };
};

export const actions = {
  /** `?/add`, the same as the library's. */
  add: addToCartAction,
} satisfies Actions;

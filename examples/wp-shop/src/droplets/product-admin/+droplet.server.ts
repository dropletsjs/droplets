import { fail } from "$droplets/server";
import { PRODUCT_ID } from "../../lib/schemas.ts";
import { requireAdmin } from "../../lib/server/admin.ts";
import { adminList, productById } from "../../lib/server/catalogue.ts";
import { integer, readForm, text } from "../../lib/server/forms.ts";
import { forgetProducts, wpConfig } from "../../lib/server/site.ts";
import { updateProduct, WordPressError } from "../../lib/server/wp.ts";
import type { Actions, LoadEvent } from "./$types";

/**
 * Stock and prices, for the WordPress admin behind the request. Without one
 * the droplet renders a link to wp-login.php that comes back to this page:
 * authorization is data, never a redirect (WordPress fetching this
 * fragment must get a fragment). Every action checks again on its own.
 */
export const load = async ({ locals, host }: LoadEvent) => {
  if (!locals.admin) {
    // `host` is the WordPress page (its Referer, a trusted origin only):
    // after logging in, WordPress sends the visitor back to it.
    const back = `${host.pathname}${host.search}`;
    return { authorized: false as const, login: `/wp-login.php?${new URLSearchParams({ redirect_to: back })}` };
  }
  return { authorized: true as const, admin: locals.admin.name, products: await adminList() };
};

type Errors = Partial<Record<"price" | "stock" | "form", string>>;

/** `14`, `14.5`, `14,50` → cents; anything else `null`. */
function cents(value: string | null): number | null {
  const match = value ? /^(\d{1,5})(?:[.,](\d{1,2}))?$/.exec(value) : null;
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "0").padEnd(2, "0"));
}

export const actions = {
  /**
   * `?/save`: a product's id, its stock and its price, written to its post
   * meta in WordPress as the admin behind the request (see `updateProduct`).
   */
  save: async (event) => {
    const denied = requireAdmin(event);
    if (denied) return denied;
    const form = await readForm(event.request);
    const id = form && text(form, "id", 20);
    if (!form || !id || !PRODUCT_ID.test(id)) return fail(400, { errors: { form: "No such product." } satisfies Errors });
    const stock = integer(form, "stock", 0, 99_999);
    const priceCents = cents(text(form, "price", 12));
    const errors: Errors = {};
    if (stock === null) errors.stock = "A whole number, 0 or more.";
    if (priceCents === null || priceCents < 1) errors.price = "A price above 0, like 14.00.";
    if (errors.stock || errors.price) return fail(400, { errors, id });

    const product = await productById(id);
    if (!product) return fail(404, { errors: { form: "No such product." } satisfies Errors });
    let saved;
    try {
      saved = await updateProduct(wpConfig(), event.locals.admin!, product.postId, {
        shop_stock: stock!,
        shop_price_cents: priceCents!,
      });
    } catch (error) {
      if (!(error instanceof WordPressError)) throw error;
      console.error(`[wp-shop] save ${id}: ${error.message}`);
      return fail(502, { errors: { form: "WordPress did not take the change. Try again, or edit it in wp-admin." } satisfies Errors, id });
    }
    forgetProducts();
    return { saved: saved.id, stock: saved.stock };
  },
} satisfies Actions;

import { error, redirect, type Entries, type TransformEvent } from "$droplets/server";
import { fillLive, fillVersions } from "../../lib/live.ts";
import { addToCartAction } from "../../lib/server/forms.ts";
import { liveValues } from "../../lib/server/live-values.ts";
import { isArchived, pageData, pageVersions } from "../../lib/server/products.ts";
import type { Actions, LoadEvent } from "./$types";

/**
 * Prerendered: one page per product in the database at build, under its
 * version then, `{ slug, v }` (see `pageVersion` in lib/server/products.ts).
 * Any other props render live, through the same load and the same
 * transform: no `v` (the canonical URL), a product added later, or a `v`
 * an edit made since (the shop's links carry the current one).
 */
export const entries = (async () =>
  [...(await pageVersions())].map(([slug, v]) => ({ props: { slug, v } }))) satisfies Entries;

/** What does not change after the build: name, text, image, related products. */
export const load = async ({ props }: LoadEvent) => {
  const data = await pageData(props.slug);
  if (data) return data;
  // Archived since: rendered all the same, and `transform` answers the
  // notice, as it does over the build's page (an old `v`).
  if (await isArchived(props.slug)) return { product: null, related: [] };
  error(404, "This product does not exist.");
};

/**
 * Runs on every request, over the stored page or the live one:
 *
 * 1. A link made before the product was edited (`v` is not its version
 *    now) is sent to the page without `v`, which renders live: the stored
 *    page for that `v` is stale, and this one is never served.
 * 2. Stock and price: the template writes `%live:stock-label%`,
 *    `%live:price%`, … where they go (see lib/live.ts); each is replaced
 *    with the value the database has now:
 *
 *      stored:  <p class="stock stock-%live:stock-state%">%live:stock-label%</p>
 *      served:  <p class="stock stock-out">Out of stock</p>
 *
 * 3. The related products' links get their pages' current `v`:
 *
 *      stored:  <a href="/product/linen-notebook%v:linen-notebook%">
 *      served:  <a href="/product/linen-notebook?v=3f9a01c2d4">
 *
 * A product archived since the build gets a short notice instead of a page.
 */
export const transform = async ({ html, props, host }: TransformEvent) => {
  // `props` went through the schema in +droplet.ts: a slug, and maybe a v.
  const slug = String(props["slug"]);
  const [live, versions] = await Promise.all([liveValues(slug), pageVersions()]);
  if (!live) return `<p class="gone">This product is no longer available. <a href="/gallery">Back to the gallery</a></p>`;

  if (props["v"] !== undefined && props["v"] !== versions.get(slug)) {
    // `host` is the host page, from the Referer its server sends (a trusted
    // origin only, see hooks.server.ts): the same page, without `v`.
    const canonical = new URL(host);
    canonical.searchParams.delete("v");
    redirect(302, canonical.href);
  }

  return fillVersions(fillLive(html, live), versions);
};

export const actions = {
  /** `?/add`: productId and qty, from the page's form. */
  add: addToCartAction,
} satisfies Actions;

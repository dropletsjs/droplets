import { error, redirect, type Entries, type TransformEvent } from "$droplets/server";
import { fillLive, fillVersions } from "../../lib/live.ts";
import { pageData, pageVersions } from "../../lib/server/catalogue.ts";
import { addToCartAction } from "../../lib/server/forms.ts";
import { liveValues } from "../../lib/server/live-values.ts";
import type { Actions, LoadEvent } from "./$types";

/**
 * Prerendered: one page per product WordPress publishes when the build
 * runs (at container start, once WordPress answers), under its version
 * then, `{ slug, v }` (see `pageVersion` in lib/server/catalogue.ts). Any
 * other props render live, through the same load and the same transform:
 * no `v` (the canonical URL), a product published later, or a `v` an edit
 * made since (the shop's links carry the current one).
 */
export const entries = (async () => [...(await pageVersions())].map(([slug, v]) => ({ props: { slug, v } }))) satisfies Entries;

/** What does not change with stock or prices: name, text, image, related products. */
export const load = async ({ props }: LoadEvent) => {
  const data = await pageData(props.slug);
  if (!data) error(404, "This product does not exist.");
  return data;
};

/**
 * Runs on every request, over the stored page or the live one:
 *
 * 1. A link made before the product was edited (`v` is not its version
 *    now) is sent to the page without `v`, which renders live. Without a
 *    page to send it to (no Referer on a trusted origin) it renders live.
 * 2. Stock and price, from WordPress's REST API now: the template writes
 *    `%live:stock-label%`, `%live:price%`, … (see lib/live.ts), each
 *    replaced here, HTML-escaped:
 *
 *      stored:  <p class="stock stock-%live:stock-state%">%live:stock-label%</p>
 *      served:  <p class="stock stock-out">Out of stock</p>
 *
 * 3. The related products' links get their pages' current `v`.
 *
 * A product WordPress no longer publishes gets a short notice instead.
 */
export const transform = async ({ html, props, locals }: TransformEvent) => {
  // `props` went through the schema in +droplet.ts: a slug, and maybe a v.
  const slug = String(props["slug"]);
  const [live, versions] = await Promise.all([liveValues(slug), pageVersions()]);
  if (!live) return `<p class="gone">This product is no longer available. <a href="/gallery">Back to the gallery</a></p>`;

  // `locals.page` is the WordPress page, from the Referer the plugin sends,
  // only when that is on wp-shop's own or a trusted origin (hooks.server.ts):
  // the same page, without `v`. Any other page gets the live render.
  if (props["v"] !== undefined && props["v"] !== versions.get(slug) && locals.page) {
    const canonical = new URL(locals.page);
    canonical.searchParams.delete("v");
    redirect(302, canonical.href);
  }

  return fillVersions(fillLive(html, live), versions);
};

export const actions = {
  /** `?/add`: productId and qty, from the page's form. */
  add: addToCartAction,
} satisfies Actions;

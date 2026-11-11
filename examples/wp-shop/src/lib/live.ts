// The product page's live fields. The page is prerendered for every
// product at build, but stock and the campaign price change afterwards, so
// the template never writes them: it writes a placeholder for each,
// `%live:<name>%`, and `transform` in product-page/+droplet.server.ts
// replaces them on every request with values read from WordPress's REST API. Live
// renders (products added after the build) go through the same step.
//
//   build:    <p class="stock stock-%live:stock-state%">%live:stock-label%</p>
//   request:  <p class="stock stock-out">Out of stock</p>

/** Every placeholder the template may use, and nothing else. */
export const LIVE_FIELDS = [
  "stock-state", //    in | low | out: classes
  "stock-label", //    In stock · Only 3 left · Out of stock
  "max-qty", //        the quantity input's max
  "disabled", //       `disabled` on the form controls when out of stock, else empty
  "button-label", //   Add to cart · Out of stock
  "price", //          what a visitor pays now
  "was-price", //      the list price during a campaign, else empty
  "sale-hidden", //    `hidden` on the SALE badge without a campaign, else empty
  "sale-pct", //       the campaign's discount, `20`
] as const;

export type LiveField = (typeof LIVE_FIELDS)[number];
export type LiveValues = Record<LiveField, string>;

const KNOWN = new Set<string>(LIVE_FIELDS);

/** What the template writes for a field: `{{live "stock-label"}}`. Unknown names throw, at build. */
export function liveToken(name: string): string {
  if (!KNOWN.has(name)) throw new Error(`product-page: no live field "${name}" (known: ${LIVE_FIELDS.join(", ")})`);
  return `%live:${name}%`;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const TOKEN = /%live:([a-z-]+)%/g;

/**
 * Replaces every `%live:<name>%` in `html` with its value, HTML-escaped
 * (safe in text and in quoted attributes). A placeholder without a value is
 * left out, never left in.
 */
export function fillLive(html: string, values: LiveValues): string {
  return html.replace(TOKEN, (_, name: string) => (KNOWN.has(name) ? escapeHtml(values[name as LiveField]) : ""));
}

// Links to other product pages (the related products) carry their page's
// version, `?v=…`, which changes when that product is edited: the template
// writes `%v:<slug>%` after each link's path and `transform` puts the
// current version there.
//
//   build:    <a href="/product/linen-notebook%v:linen-notebook%">
//   request:  <a href="/product/linen-notebook?v=3f9a01c2d4">

const SLUG_TOKEN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_TOKEN = /%v:([a-z0-9-]+)%/g;

/** What the template writes after a product link's path: `{{productHref slug}}`. */
export function versionToken(slug: string): string {
  if (!SLUG_TOKEN.test(slug)) throw new Error(`product-page: not a slug: ${JSON.stringify(slug)}`);
  return `%v:${slug}%`;
}

/** Replaces every `%v:<slug>%` with `?v=<that page's version>`, or nothing for a product that is gone. */
export function fillVersions(html: string, versions: ReadonlyMap<string, string>): string {
  return html.replace(VERSION_TOKEN, (_, slug: string) => {
    const v = versions.get(slug);
    return v ? `?v=${v}` : "";
  });
}

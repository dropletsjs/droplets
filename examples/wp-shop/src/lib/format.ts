import type { StockState } from "./types.ts";

// Formatting every framework shares. Deterministic (fixed locale, UTC), so
// the server's markup and the browser's first render agree.

/**
 * A link to a product page on the host: with the page's current version
 * (`v`) when the shop knows it, so an unedited product is served from the
 * build and an edited one renders live; `/product/<slug>` alone always
 * renders live (the canonical, shareable URL).
 */
export const productHref = (slug: string, v?: string) => (v ? `/product/${slug}?${new URLSearchParams({ v })}` : `/product/${slug}`);

const money = new Map<string, Intl.NumberFormat>();

/** `1120` → `€11.20`. */
export function formatMoney(cents: number, currency = "EUR"): string {
  let format = money.get(currency);
  if (!format) {
    format = new Intl.NumberFormat("en-IE", { style: "currency", currency });
    money.set(currency, format);
  }
  return format.format(cents / 100);
}

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** `2026-11-03T…` → `3 Nov 2026`. */
export const formatDate = (iso: string) => day.format(new Date(iso));

/** The stock line every card and page shows. */
export function stockLabel(state: StockState, stock: number): string {
  if (state === "out") return "Out of stock";
  if (state === "low") return `Only ${stock} left`;
  return "In stock";
}

export const stockState = (stock: number): StockState => (stock <= 0 ? "out" : stock <= 5 ? "low" : "in");

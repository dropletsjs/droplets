import { formatMoney, stockLabel } from "../format.ts";
import type { LiveValues } from "../live.ts";
import { cardBySlug } from "./catalogue.ts";

/** The product page's live fields for a product, from WordPress now; `null` when it is gone. */
export async function liveValues(slug: string): Promise<LiveValues | null> {
  const card = await cardBySlug(slug);
  if (!card) return null;
  const out = card.stockState === "out";
  const onSale = card.salePriceCents !== null;
  return {
    "stock-state": card.stockState,
    "stock-label": stockLabel(card.stockState, card.stock),
    "max-qty": String(Math.max(1, Math.min(card.stock, 20))),
    disabled: out ? "disabled" : "",
    "button-label": out ? "Out of stock" : "Add to cart",
    price: formatMoney(card.salePriceCents ?? card.priceCents, card.currency),
    "was-price": onSale ? formatMoney(card.priceCents, card.currency) : "",
    "sale-hidden": onSale ? "" : "hidden",
    "sale-pct": onSale ? String(card.salePct) : "",
  };
}

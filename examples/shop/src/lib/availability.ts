import { stockState } from "./format.ts";
import type { CartLine, StockState } from "./types.ts";

/** A cart line's availability: what `/api/stock/check` answered, or the cart's own figures before it did. */
export type LineAvailability = { stock: number; state: StockState };

/** What the cart drawer shows for each line, and whether checkout may go ahead. */
export type CartAvailability = {
  lines: Map<string, LineAvailability>;
  /** The ids of the lines that cannot be bought now: sold out, or gone from the shop. */
  out: string[];
};

/** A stock check: the ids asked about, and `/api/stock/check`'s answer for them. */
export type StockCheck = { ids: readonly string[]; items: readonly { id: string; stock: number }[] };

/**
 * The cart's lines against a stock check, or `null` before one answered.
 * A line the check asked about takes its answer, and one it asked about
 * but was not answered is no longer sold (unknown or archived): out of
 * stock. A line the check did not ask about (added since) keeps the
 * cart's own figures.
 */
export function cartAvailability(lines: readonly CartLine[], check: StockCheck | null): CartAvailability {
  const asked = new Set(check?.ids ?? []);
  const answered = new Map((check?.items ?? []).map((item) => [item.id, item.stock]));
  const result = new Map<string, LineAvailability>();
  const out: string[] = [];
  for (const line of lines) {
    const checked = asked.has(line.productId);
    const stock = checked ? (answered.get(line.productId) ?? 0) : line.stock;
    const state = checked ? stockState(stock) : line.stockState;
    result.set(line.productId, { stock, state });
    if (state === "out") out.push(line.productId);
  }
  return { lines: result, out };
}

/** The cart's check, never shorter than `ms`: a loading state that only flickers reads as a glitch. */
export async function atLeast<T>(work: Promise<T>, ms: number): Promise<T> {
  const [value] = await Promise.all([work, new Promise((resolve) => setTimeout(resolve, ms))]);
  return value;
}

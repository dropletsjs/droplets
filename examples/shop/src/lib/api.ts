import droplet from "$droplets/drop";
import type { Cart, CardProduct, Comment, CommentOrder, Filter, StockState } from "./types.ts";

// The shop's /api, for every framework. `droplet.url()` points at the
// droplets server (through the host's proxy when there is one); a plain
// `fetch("/api/…")` would ask the host page's origin. Cookies (`cart_id`)
// go along: same origin behind the proxy, `include` for anything else.

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(droplet.url(path), { credentials: "include", ...init });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** The image's URL on the droplets server. */
export const imageUrl = (key: string) => droplet.url(`/api/images/${encodeURIComponent(key)}`);

export type ProductList = { items: CardProduct[]; total: number; nextCursor: string | null };

export function listProducts(filter: Filter, options: { limit?: number; cursor?: string } = {}) {
  const query = new URLSearchParams({ q: filter.q, category: filter.category, sort: filter.sort });
  if (filter.onSale) query.set("onSale", "1");
  if (options.limit) query.set("limit", String(options.limit));
  if (options.cursor) query.set("cursor", options.cursor);
  return call<ProductList>(`/api/products?${query}`);
}

export const getCart = () => call<{ cart: Cart }>("/api/cart").then((body) => body.cart);

export type StockInfo = { id: string; stock: number; stockState: StockState; priceCents: number; salePriceCents: number | null };

export const checkStock = (ids: string[]) =>
  call<{ items: StockInfo[] }>("/api/stock/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: ids.slice(0, 50) }),
  }).then((body) => body.items);

export type CommentList = { comments: Comment[]; total: number; pageCount: number; page: number };

export function listComments(productId: string, order: CommentOrder, page: number, showing: number) {
  const query = new URLSearchParams({ productId, order, page: String(page), showing: String(showing) });
  return call<CommentList>(`/api/comments?${query}`);
}

/**
 * A droplet's server load through `GET /droplets/<id>/_data`: the public,
 * cacheable read, props in the query. Prerendered props answer from the
 * build's store, the rest run the load.
 */
export async function readData<T>(id: string, props: Record<string, string | number>): Promise<T> {
  const query = new URLSearchParams(Object.entries(props).map(([k, v]) => [k, String(v)]));
  const body = await call<{ data: T }>(`/droplets/${encodeURIComponent(id)}/_data?${query}`);
  return body.data;
}

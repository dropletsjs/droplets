// What the droplets and /api exchange: plain JSON, the same on the server
// and in the browser. Neutral: every framework imports these. The server
// builds them from WordPress's answers, once checked (lib/server/wp.ts).

/** `out` at 0, `low` from 1 to 5, `in` above. */
export type StockState = "in" | "low" | "out";

export type Badge = "sale" | "new";

/** A product as a card shows it: the library, the card, related products. */
export type CardProduct = {
  id: string;
  slug: string;
  name: string;
  category: string;
  priceCents: number;
  /** The campaign price, `null` when no campaign covers the product. */
  salePriceCents: number | null;
  /** The campaign's discount in percent, `null` without one. */
  salePct: number | null;
  currency: string;
  /** Its image in WordPress's Media Library: a URL on WP_PUBLIC_URL, checked by the server. */
  image: string;
  stock: number;
  stockState: StockState;
  badges: Badge[];
  /** The product page's current version, for links to it: `/product/<slug>?v=<v>`. */
  v?: string;
};

/** A product page's static part: what can be prerendered. */
export type PageProduct = {
  id: string;
  slug: string;
  name: string;
  category: { slug: string; name: string };
  description: string;
  details: string[];
  image: string;
};

/** Another product of the same category, as the product page lists it. */
export type RelatedProduct = { slug: string; name: string; image: string };

/** Everything the product page renders that is not live: its load's data, and what its `v` hashes. */
export type PageData = { product: PageProduct; related: RelatedProduct[] };

export type Category = { slug: string; name: string; count: number };

/** The library's sale banner: the products with a campaign discount (`shop_sale_pct`) in WordPress. */
export type Campaign = { name: string; pct: number; endsAt: string | null };

export type CartLine = {
  productId: string;
  slug: string;
  name: string;
  image: string;
  qty: number;
  unitCents: number;
  /** The list price when a campaign lowers `unitCents`, else `null`. */
  wasCents: number | null;
  lineCents: number;
  stock: number;
  stockState: StockState;
  /** The product page's current version, for the line's link (none once archived). */
  v?: string;
};

export type Cart = { count: number; totalCents: number; currency: string; items: CartLine[] };

export type Comment = { id: string; author: string; body: string; createdAt: string };

export type CommentOrder = "oldest" | "newest";

/** The library's filter: the props of product-filter and product-library, and /api/products. */
export type Filter = {
  q: string;
  category: string;
  sort: "new" | "price-asc" | "price-desc";
  onSale: boolean;
};

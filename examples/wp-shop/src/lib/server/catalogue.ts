import { createHash } from "node:crypto";
import { CATEGORIES, categoryName } from "../categories.ts";
import { stockState } from "../format.ts";
import type { CardProduct, Campaign, Category, Filter, PageData } from "../types.ts";
import { allProducts } from "./site.ts";
import type { WpProduct } from "./wp.ts";

// The catalogue as the shop's droplets want it, from WordPress's products
// (site.ts, wp.ts). A demo-sized catalogue: filtered and sorted in memory.

/** A product is NEW for two weeks after it was published. */
const NEW_FOR_MS = 14 * 24 * 60 * 60 * 1000;

/** The price with the product's campaign discount, `null` without one. */
export const salePrice = (product: WpProduct) =>
  product.salePct > 0 ? Math.round((product.priceCents * (100 - product.salePct)) / 100) : null;

/** `v`: the product page's version (from `pageVersions()`), for the card's link. */
export function toCard(product: WpProduct, v?: string, at = Date.now()): CardProduct {
  const sale = salePrice(product);
  const badges: CardProduct["badges"] = [];
  if (sale !== null) badges.push("sale");
  if (at - Date.parse(product.createdAt) < NEW_FOR_MS) badges.push("new");
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category,
    priceCents: product.priceCents,
    salePriceCents: sale,
    salePct: sale === null ? null : product.salePct,
    currency: "EUR",
    image: product.image,
    stock: product.stock,
    stockState: stockState(product.stock),
    badges,
    ...(v ? { v } : {}),
  };
}

/** The library's banner: the deepest discount on any product. */
export function campaignOf(products: readonly WpProduct[]): Campaign | null {
  const pct = Math.max(0, ...products.map((product) => product.salePct));
  return pct > 0 ? { name: "Sale", pct, endsAt: null } : null;
}

/**
 * The library's list, sorted by the price a visitor pays (the campaign's
 * when there is one), or newest first.
 */
export async function listProducts(filter: Filter, offset: number, limit: number) {
  const products = await allProducts();
  const versions = pageVersionsOf(products);
  const q = filter.q.toLowerCase();
  let matching = products.filter(
    (product) =>
      (!filter.category || product.category === filter.category) &&
      (!q || product.name.toLowerCase().includes(q) || product.description.toLowerCase().includes(q)),
  );
  if (filter.onSale) matching = matching.filter((product) => product.salePct > 0);
  const cards = matching.map((product) => toCard(product, versions.get(product.slug)));
  const paid = (card: CardProduct) => card.salePriceCents ?? card.priceCents;
  const created = new Map(matching.map((product) => [product.id, product.createdAt]));
  cards.sort((a, b) => {
    if (filter.sort === "price-asc") return paid(a) - paid(b) || a.id.localeCompare(b.id);
    if (filter.sort === "price-desc") return paid(b) - paid(a) || a.id.localeCompare(b.id);
    return created.get(b.id)!.localeCompare(created.get(a.id)!) || a.id.localeCompare(b.id);
  });
  return { total: cards.length, items: cards.slice(offset, offset + limit), campaign: campaignOf(products) };
}

export async function categoriesWithCounts(): Promise<Category[]> {
  const products = await allProducts();
  return CATEGORIES.map(({ slug, name }) => ({ slug, name, count: products.filter((p) => p.category === slug).length }));
}

export const productBySlug = async (slug: string) => (await allProducts()).find((product) => product.slug === slug);
export const productById = async (id: string) => (await allProducts()).find((product) => product.id === id);

export async function productsByIds(ids: readonly string[]): Promise<WpProduct[]> {
  const wanted = new Set(ids);
  return (await allProducts()).filter((product) => wanted.has(product.id));
}

export async function cardBySlug(slug: string): Promise<CardProduct | null> {
  const products = await allProducts();
  const product = products.find((each) => each.slug === slug);
  return product ? toCard(product, pageVersionsOf(products).get(slug)) : null;
}

/** How many other products of its category a product page lists. */
const RELATED = 4;

/**
 * The product page's data: its own fields, and up to four other products
 * of its category (newest first, as WordPress lists them). Pure, so the
 * page's load and `pageVersions()` build exactly the same thing.
 */
function pageDataOf(product: WpProduct, all: readonly WpProduct[]): PageData {
  return {
    product: {
      id: product.id,
      slug: product.slug,
      name: product.name,
      category: { slug: product.category, name: categoryName(product.category) },
      description: product.description,
      details: product.details,
      image: product.image,
    },
    related: all
      .filter((other) => other.category === product.category && other.id !== product.id)
      .slice(0, RELATED)
      .map(({ slug, name, image }) => ({ slug, name, image })),
  };
}

/** The part of a product page that does not change with stock or prices: what its load returns. */
export async function pageData(slug: string): Promise<PageData | null> {
  const products = await allProducts();
  const product = products.find((each) => each.slug === slug);
  return product ? pageDataOf(product, products) : null;
}

/**
 * The product page's version, its `v` prop: a short hash of the fields it
 * shows (name, text, details, image, category, related products), never
 * of stock or prices, which `transform` fills in live. A post's `modified`
 * would do too, but it moves with every stock edit, and the stored page
 * would be passed over for nothing.
 */
export const pageVersion = (data: PageData) => createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 10);

function pageVersionsOf(products: readonly WpProduct[]): Map<string, string> {
  return new Map(products.map((product) => [product.slug, pageVersion(pageDataOf(product, products))]));
}

/** Every product's page version, by slug. */
export const pageVersions = async () => pageVersionsOf(await allProducts());

/** The admin's list: newest first, with the post id for the wp-admin link. */
export async function adminList() {
  return (await allProducts()).map((product) => ({ ...toCard(product), postId: product.postId }));
}

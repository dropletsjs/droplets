import { createHash, randomBytes } from "node:crypto";
import { sql, type Selectable } from "kysely";
import { stockState } from "../format.ts";
import type { Campaign, CardProduct, Category, Filter, PageData } from "../types.ts";
import { currentCampaign, salePrice } from "./campaigns.ts";
import { db, now, type DB } from "./db.ts";

type Row = Selectable<DB["products"]>;

/** A product is NEW for two weeks after it was added. */
const NEW_FOR_MS = 14 * 24 * 60 * 60 * 1000;

/** `v`: the product page's version (from `pageVersions()`), for the card's link. */
export function toCard(row: Row, campaign: Campaign | null, v?: string, at = Date.now()): CardProduct {
  const sale = salePrice(campaign, row.id, row.price_cents);
  const badges: CardProduct["badges"] = [];
  if (sale !== null) badges.push("sale");
  if (at - Date.parse(row.created_at) < NEW_FOR_MS) badges.push("new");
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    priceCents: row.price_cents,
    salePriceCents: sale,
    salePct: sale === null ? null : campaign!.pct,
    currency: row.currency,
    image: row.image,
    stock: row.stock,
    stockState: stockState(row.stock),
    badges,
    ...(v ? { v } : {}),
  };
}

const active = () => db().selectFrom("products").selectAll().where("status", "=", "active");

/** `%` and `_` are LIKE wildcards; a search for them means them. */
const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * The library's list: filtered in SQL, sorted by the price a visitor pays
 * (the campaign's when there is one). A demo-sized catalogue, so the sort
 * and the sale filter run on the matching rows in memory.
 */
export async function listProducts(filter: Filter, offset: number, limit: number) {
  let query = active();
  if (filter.category) query = query.where("category", "=", filter.category);
  if (filter.q) {
    const term = likeTerm(filter.q);
    query = query.where(sql<boolean>`(name LIKE ${term} ESCAPE '\\' OR description LIKE ${term} ESCAPE '\\')`);
  }
  const [rows, campaign, versions] = await Promise.all([query.execute(), currentCampaign(), pageVersions()]);
  let cards = rows.map((row) => toCard(row, campaign, versions.get(row.slug)));
  if (filter.onSale) cards = cards.filter((card) => card.salePriceCents !== null);
  const paid = (card: CardProduct) => card.salePriceCents ?? card.priceCents;
  const created = new Map(rows.map((row) => [row.id, row.created_at]));
  cards.sort((a, b) => {
    if (filter.sort === "price-asc") return paid(a) - paid(b) || a.id.localeCompare(b.id);
    if (filter.sort === "price-desc") return paid(b) - paid(a) || a.id.localeCompare(b.id);
    return created.get(b.id)!.localeCompare(created.get(a.id)!) || a.id.localeCompare(b.id);
  });
  return { total: cards.length, items: cards.slice(offset, offset + limit), campaign };
}

export async function categoriesWithCounts(): Promise<Category[]> {
  const rows = await db()
    .selectFrom("categories")
    .leftJoin("products", (join) => join.onRef("products.category", "=", "categories.slug").on("products.status", "=", "active"))
    .select(["categories.slug", "categories.name", (eb) => eb.fn.count<number>("products.id").as("count")])
    .groupBy(["categories.slug", "categories.name", "categories.position"])
    .orderBy("categories.position")
    .execute();
  return rows.map((row) => ({ slug: row.slug, name: row.name, count: Number(row.count) }));
}

export const productBySlug = (slug: string) => active().where("slug", "=", slug).executeTakeFirst();
export const productById = (id: string) => active().where("id", "=", id).executeTakeFirst();

/** Whether `slug` names a product that was archived (deleted in the admin); slugs are never reused. */
export const isArchived = async (slug: string) =>
  !!(await db().selectFrom("products").select("id").where("slug", "=", slug).where("status", "=", "archived").executeTakeFirst());

export async function productsByIds(ids: string[]): Promise<Row[]> {
  if (!ids.length) return [];
  return active().where("id", "in", ids).execute();
}

export async function cardBySlug(slug: string): Promise<CardProduct | null> {
  const [row, campaign, versions] = await Promise.all([productBySlug(slug), currentCampaign(), pageVersions()]);
  return row ? toCard(row, campaign, versions.get(row.slug)) : null;
}

/** How many other products of its category a product page lists. */
const RELATED = 4;

/** Newest first, then by id: every query in the same order, so the same related products. */
const newestFirst = (query: ReturnType<typeof active>) => query.orderBy("created_at", "desc").orderBy("id");

/**
 * The product page's data for `row`: its own fields, and up to four other
 * products of its category from `sameCategory` (newest first). Pure, so the
 * page's load and `pageVersions()` build exactly the same thing.
 */
function pageDataOf(row: Row, categoryName: string | undefined, sameCategory: readonly Row[]): PageData {
  return {
    product: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: { slug: row.category, name: categoryName ?? row.category },
      description: row.description,
      details: row.details.split(" · ").filter(Boolean),
      image: row.image,
    },
    related: sameCategory
      .filter((other) => other.id !== row.id)
      .slice(0, RELATED)
      .map(({ slug, name, image }) => ({ slug, name, image })),
  };
}

/** The part of a product page that does not change with stock or campaigns: what its load returns. */
export async function pageData(slug: string): Promise<PageData | null> {
  const row = await productBySlug(slug);
  if (!row) return null;
  const [category, sameCategory] = await Promise.all([
    db().selectFrom("categories").select("name").where("slug", "=", row.category).executeTakeFirst(),
    newestFirst(active().where("category", "=", row.category)).execute(),
  ]);
  return pageDataOf(row, category?.name, sameCategory);
}

/**
 * The product page's version, its `v` prop: a short hash of its data. The
 * template is fixed per build, so the same data renders the same HTML, and
 * a prerendered page whose `v` is current is never stale. An admin edit to
 * what the page shows (name, text, details, image, category, or a related
 * product's name or image) changes `v`; stock and prices are filled in live,
 * so they never do.
 */
export const pageVersion = (data: PageData) => createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 10);

/**
 * Every active product's page version, by slug: two reads of the whole
 * (demo-sized) catalogue. A large shop would keep `v` in a column instead,
 * written whenever a product or one it lists as related changes.
 */
export async function pageVersions(): Promise<Map<string, string>> {
  const [rows, categories] = await Promise.all([
    newestFirst(active()).execute(),
    db().selectFrom("categories").select(["slug", "name"]).execute(),
  ]);
  const names = new Map(categories.map((category) => [category.slug, category.name]));
  const byCategory = new Map<string, Row[]>();
  for (const row of rows) byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row]);
  return new Map(rows.map((row) => [row.slug, pageVersion(pageDataOf(row, names.get(row.category), byCategory.get(row.category) ?? []))]));
}

export async function adminList() {
  const [rows, campaign] = await Promise.all([active().orderBy("created_at", "desc").execute(), currentCampaign()]);
  return rows.map((row) => ({ ...toCard(row, campaign), updatedAt: row.updated_at }));
}

export async function adminProduct(id: string) {
  const row = await productById(id);
  return (
    row && {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      details: row.details,
      priceCents: row.price_cents,
      category: row.category,
      stock: row.stock,
      image: row.image,
    }
  );
}

export type ProductInput = {
  name: string;
  slug: string;
  description: string;
  details: string;
  priceCents: number;
  category: string;
  stock: number;
};

export const slugTaken = async (slug: string, except?: string) => {
  let query = db().selectFrom("products").select("id").where("slug", "=", slug);
  if (except) query = query.where("id", "!=", except);
  return !!(await query.executeTakeFirst());
};

export const categoryExists = async (slug: string) =>
  !!(await db().selectFrom("categories").select("slug").where("slug", "=", slug).executeTakeFirst());

export async function createProduct(input: ProductInput, image: string): Promise<string> {
  const id = `p_${randomBytes(5).toString("hex")}`;
  const at = now();
  await db()
    .insertInto("products")
    .values({
      id,
      slug: input.slug,
      name: input.name,
      description: input.description,
      details: input.details,
      price_cents: input.priceCents,
      currency: "EUR",
      category: input.category,
      stock: input.stock,
      status: "active",
      image,
      created_at: at,
      updated_at: at,
    })
    .execute();
  return id;
}

export async function updateProduct(id: string, input: ProductInput, image?: string): Promise<boolean> {
  const result = await db()
    .updateTable("products")
    .set({
      slug: input.slug,
      name: input.name,
      description: input.description,
      details: input.details,
      price_cents: input.priceCents,
      category: input.category,
      stock: input.stock,
      ...(image ? { image } : {}),
      updated_at: now(),
    })
    .where("id", "=", id)
    .where("status", "=", "active")
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

/** Deleting archives: carts and comments keep pointing at a real row. */
export async function archiveProduct(id: string): Promise<boolean> {
  const result = await db()
    .updateTable("products")
    .set({ status: "archived", updated_at: now() })
    .where("id", "=", id)
    .where("status", "=", "active")
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

export async function setStock(id: string, stock: number): Promise<boolean> {
  const result = await db()
    .updateTable("products")
    .set({ stock, updated_at: now() })
    .where("id", "=", id)
    .where("status", "=", "active")
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

export async function categoryList() {
  return db().selectFrom("categories").select(["slug", "name"]).orderBy("position").execute();
}

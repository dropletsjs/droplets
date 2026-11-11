// Creates shop.db (or SHOP_DATABASE): the schema, then the products and
// comments in data/*.json, a running campaign and an ended one.
//
//   node scripts/seed.ts               (replaces the database)
//   node scripts/seed.ts --if-missing  (only when there is none: `pnpm build` and `pnpm dev`)
//
// The build reads the database (product pages and full comment pages are
// prerendered from it), so seed before `vite build`.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { databasePath, migrate, openDatabase } from "../src/lib/server/db.ts";

const path = databasePath();
if (process.argv.includes("--if-missing") && existsSync(path)) process.exit(0);

type SeedProduct = {
  slug: string;
  name: string;
  category: string;
  description: string;
  details: string;
  priceCents: number;
};
type SeedData = { categories: Array<{ slug: string; name: string }>; products: SeedProduct[] };
/** `daysAgo`: when it was posted, counted back from the seed. Without it, a few days apart. */
type SeedComment = { product: string; author: string; body: string; daysAgo?: number };

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8")) as T;
const { categories, products } = read<SeedData>("products.json");
const comments = read<SeedComment[]>("comments.json");

for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
const db = openDatabase(path);
await migrate(db);

const DAY = 24 * 60 * 60 * 1000;
const at = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const productId = (slug: string) => `p_${createHash("sha256").update(slug).digest("hex").slice(0, 10)}`;

// Stock that shows every state on the first gallery page: out, low, plenty.
const STOCK = [12, 3, 25, 0, 8, 40, 2, 15, 9, 30, 18, 5, 22, 7, 60, 14, 0, 11, 33, 4];

// Comments, oldest first per product.
const bySlug = new Map<string, SeedComment[]>();
for (const c of comments) bySlug.set(c.product, [...(bySlug.get(c.product) ?? []), c]);
const postedDaysAgo = (list: SeedComment[]) => list.map((c, i) => c.daysAgo ?? (list.length - i) * 3).sort((a, b) => b - a);

await db
  .insertInto("categories")
  .values(categories.map((c, position) => ({ ...c, position })))
  .execute();
await db
  .insertInto("products")
  .values(
    products.map((p, i) => ({
      id: productId(p.slug),
      slug: p.slug,
      name: p.name,
      description: p.description,
      details: p.details,
      price_cents: p.priceCents,
      currency: "EUR",
      category: p.category,
      stock: STOCK[i % STOCK.length]!,
      status: "active",
      image: `${p.slug}.webp`,
      // Spread over four months; every fifth one is new (NEW for two weeks).
      // Never younger than its oldest comment.
      created_at: iso(at - Math.max(i % 5 === 2 ? 3 + i / 5 : 20 + i * 6, (postedDaysAgo(bySlug.get(p.slug) ?? [])[0] ?? 0) + 2) * DAY),
      updated_at: iso(at - DAY),
    })),
  )
  .execute();

// A running campaign on a few products, and one that ended.
await db
  .insertInto("campaigns")
  .values([
    {
      id: "c_spring",
      name: "Spring sale",
      pct: 10,
      scope: "all",
      starts_at: iso(at - 200 * DAY),
      ends_at: iso(at - 170 * DAY),
      stopped_at: null,
      created_at: iso(at - 210 * DAY),
    },
    {
      id: "c_autumn",
      name: "Autumn sale",
      pct: 20,
      scope: "selected",
      starts_at: iso(at - 2 * DAY),
      ends_at: iso(at + 30 * DAY),
      stopped_at: null,
      created_at: iso(at - 3 * DAY),
    },
  ])
  .execute();
await db
  .insertInto("campaign_products")
  .values(products.filter((_, i) => i % 4 === 0).map((p) => ({ campaign_id: "c_autumn", product_id: productId(p.slug) })))
  .execute();

const rows = [...bySlug].flatMap(([slug, list]) => {
  const days = postedDaysAgo(list);
  return [...list]
    .sort((a, b) => (b.daysAgo ?? 0) - (a.daysAgo ?? 0))
    .map((c, i) => {
      const created = Math.round(at - days[i]! * DAY - (slug.length % 7) * 3_600_000);
      return {
        id: `m_${created.toString(36).padStart(9, "0")}${productId(slug).slice(2, 8)}${String(i).padStart(2, "0")}`,
        product_id: productId(slug),
        author: c.author.slice(0, 40),
        body: c.body.slice(0, 1000),
        created_at: iso(created),
      };
    });
});
if (rows.length) await db.insertInto("comments").values(rows).execute();

await db.destroy();
console.log(`seeded ${path}: ${products.length} products, ${rows.length} comments`);

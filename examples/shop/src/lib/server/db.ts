import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { Migrator, type Migration } from "kysely/migration";
import { migrations } from "./migrations.ts";

/**
 * The shop's tables. Text ids, integer cents, ISO-8601 timestamps: nothing
 * here is SQLite-only, so a Postgres dialect would take the same schema.
 */
export type DB = {
  categories: { slug: string; name: string; position: number };
  products: {
    id: string;
    slug: string;
    name: string;
    description: string;
    details: string;
    price_cents: number;
    currency: string;
    category: string;
    stock: number;
    /** `active` or `archived`: a deleted product is archived, never removed. */
    status: string;
    /** The image's key under /api/images/. */
    image: string;
    created_at: string;
    updated_at: string;
  };
  campaigns: {
    id: string;
    name: string;
    pct: number;
    /** `all`, or `selected`: the products in campaign_products. */
    scope: string;
    starts_at: string;
    ends_at: string | null;
    stopped_at: string | null;
    created_at: string;
  };
  campaign_products: { campaign_id: string; product_id: string };
  carts: { id: string; created_at: string; updated_at: string };
  cart_items: { cart_id: string; product_id: string; qty: number; added_at: string };
  comments: { id: string; product_id: string; author: string; body: string; created_at: string };
};

/** `SHOP_DATABASE`, else `shop.db` in the working directory. */
export const databasePath = () => process.env["SHOP_DATABASE"] ?? "shop.db";

let instance: Kysely<DB> | undefined;

/** The database, opened on first use. */
export function db(): Kysely<DB> {
  instance ??= openDatabase(databasePath());
  return instance;
}

export function openDatabase(path: string): Kysely<DB> {
  const database = new Database(path);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  return new Kysely<DB>({ dialect: new SqliteDialect({ database }) });
}

/** Brings the schema up to date; `scripts/seed.ts` runs it. */
export async function migrate(database: Kysely<DB>): Promise<void> {
  const migrator = new Migrator({
    db: database,
    provider: { getMigrations: async (): Promise<Record<string, Migration>> => migrations },
  });
  const { error, results } = await migrator.migrateToLatest();
  for (const result of results ?? []) {
    if (result.status === "Error") throw new Error(`migration ${result.migrationName} failed`);
  }
  if (error) throw error;
}

export const now = () => new Date().toISOString();

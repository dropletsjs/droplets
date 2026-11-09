import Database from "better-sqlite3";

/**
 * wp-shop's own data: the carts, in SQLite (`WP_SHOP_DATABASE`, default
 * `wp-shop.db`). Products and comments are WordPress's; a cart line names a
 * product by its id (`p_<post id>`) and is checked against WordPress each
 * time it is read. The schema is created on first use.
 */
export const databasePath = () => process.env["WP_SHOP_DATABASE"] || "wp-shop.db";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS carts (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cart_items (
    cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    qty INTEGER NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (cart_id, product_id)
  );
`;

let instance: Database.Database | undefined;

export function db(): Database.Database {
  if (!instance) {
    instance = new Database(databasePath());
    instance.pragma("journal_mode = WAL");
    instance.pragma("foreign_keys = ON");
    instance.exec(SCHEMA);
  }
  return instance;
}

export const now = () => new Date().toISOString();

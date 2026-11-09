import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/**
 * The schema, one migration per change. Kysely records which ran in its
 * own table; `migrate()` in db.ts applies the rest in order.
 */
export const migrations: Record<string, Migration> = {
  "001_init": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("categories")
        .addColumn("slug", "text", (c) => c.primaryKey())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("position", "integer", (c) => c.notNull().defaultTo(0))
        .execute();

      await db.schema
        .createTable("products")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("slug", "text", (c) => c.notNull().unique())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("description", "text", (c) => c.notNull())
        .addColumn("details", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("price_cents", "integer", (c) => c.notNull())
        .addColumn("currency", "text", (c) => c.notNull().defaultTo("EUR"))
        .addColumn("category", "text", (c) => c.notNull().references("categories.slug"))
        .addColumn("stock", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("status", "text", (c) => c.notNull().defaultTo("active"))
        .addColumn("image", "text", (c) => c.notNull())
        .addColumn("created_at", "text", (c) => c.notNull())
        .addColumn("updated_at", "text", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("products_status_created").on("products").columns(["status", "created_at"]).execute();
      await db.schema.createIndex("products_status_category").on("products").columns(["status", "category"]).execute();

      await db.schema
        .createTable("campaigns")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("pct", "integer", (c) => c.notNull())
        .addColumn("scope", "text", (c) => c.notNull())
        .addColumn("starts_at", "text", (c) => c.notNull())
        .addColumn("ends_at", "text")
        .addColumn("stopped_at", "text")
        .addColumn("created_at", "text", (c) => c.notNull())
        .execute();
      await db.schema
        .createTable("campaign_products")
        .addColumn("campaign_id", "text", (c) => c.notNull().references("campaigns.id").onDelete("cascade"))
        .addColumn("product_id", "text", (c) => c.notNull().references("products.id"))
        .addPrimaryKeyConstraint("campaign_products_pk", ["campaign_id", "product_id"])
        .execute();

      await db.schema
        .createTable("carts")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("created_at", "text", (c) => c.notNull())
        .addColumn("updated_at", "text", (c) => c.notNull())
        .execute();
      await db.schema
        .createTable("cart_items")
        .addColumn("cart_id", "text", (c) => c.notNull().references("carts.id").onDelete("cascade"))
        .addColumn("product_id", "text", (c) => c.notNull().references("products.id"))
        .addColumn("qty", "integer", (c) => c.notNull())
        .addColumn("added_at", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("cart_items_pk", ["cart_id", "product_id"])
        .execute();

      await db.schema
        .createTable("comments")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("product_id", "text", (c) => c.notNull().references("products.id"))
        .addColumn("author", "text", (c) => c.notNull())
        .addColumn("body", "text", (c) => c.notNull())
        .addColumn("created_at", "text", (c) => c.notNull())
        .execute();
      // Oldest first is ORDER BY created_at, id; newest first the same, descending.
      await db.schema.createIndex("comments_product_created").on("comments").columns(["product_id", "created_at", "id"]).execute();
    },
  },
};

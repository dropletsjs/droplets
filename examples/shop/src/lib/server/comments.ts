import { randomBytes } from "node:crypto";
import type { Comment, CommentOrder } from "../types.ts";
import { db, now } from "./db.ts";

export type CommentQuery = { productId: string; order: CommentOrder; page: number; showing: number };

/**
 * One page of a product's comments. Page-based: with `oldest` first new
 * comments land at the end, so a full page never changes, which is what
 * lets those pages be prerendered (see `commentEntries`).
 */
export async function commentsPage({ productId, order, page, showing }: CommentQuery): Promise<Comment[]> {
  const direction = order === "oldest" ? "asc" : "desc";
  const rows = await db().selectFrom("comments")
    .select(["id", "author", "body", "created_at"])
    .where("product_id", "=", productId)
    .orderBy("created_at", direction)
    .orderBy("id", direction)
    .limit(showing)
    .offset((page - 1) * showing)
    .execute();
  return rows.map((row) => ({ id: row.id, author: row.author, body: row.body, createdAt: row.created_at }));
}

export async function countComments(productId: string): Promise<number> {
  const row = await db().selectFrom("comments").select((eb) => eb.fn.countAll<number>().as("n"))
    .where("product_id", "=", productId).executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** Every active product with its comment count, for `entries()` at build. */
export async function commentCounts(): Promise<Array<{ productId: string; count: number }>> {
  const rows = await db().selectFrom("products")
    .leftJoin("comments", "comments.product_id", "products.id")
    .select(["products.id", (eb) => eb.fn.count<number>("comments.id").as("count")])
    .where("products.status", "=", "active")
    .groupBy("products.id")
    .orderBy("products.id")
    .execute();
  return rows.map((row) => ({ productId: row.id, count: Number(row.count) }));
}

/** Time-ordered ids: the creation time, then randomness for ties. */
export const commentId = (at: Date) => `m_${at.getTime().toString(36).padStart(9, "0")}${randomBytes(4).toString("hex")}`;

export async function postComment(productId: string, author: string, body: string): Promise<string> {
  const at = new Date(now());
  const id = commentId(at);
  await db().insertInto("comments").values({ id, product_id: productId, author, body, created_at: at.toISOString() })
    .execute();
  return id;
}

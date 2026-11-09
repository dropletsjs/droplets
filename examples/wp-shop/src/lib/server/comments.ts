import type { Comment, CommentOrder } from "../types.ts";
import { allProducts, wpConfig } from "./site.ts";
import { countComments as countWp, createComment, fetchComments, type CommentResult } from "./wp.ts";

// A product's comments are WordPress's own comments on its post: read and
// written through `wp/v2/comments` (wp.ts).

export type CommentQuery = { productId: string; order: CommentOrder; page: number; showing: number };

/** `p_12` → 12. The props schema already checked the shape. */
export const postIdOf = (productId: string) => Number(productId.slice(2));

/**
 * One page of a product's comments. Page-based: with `oldest` first new
 * comments land at the end, so a full page never changes, which is what
 * lets those pages be prerendered (see `commentEntries`).
 */
export const commentsPage = ({ productId, ...page }: CommentQuery): Promise<Comment[]> =>
  fetchComments(wpConfig(), postIdOf(productId), page);

export const countComments = (productId: string) => countWp(wpConfig(), postIdOf(productId));

/** Every product with its comment count, for `entries()` at build. */
export async function commentCounts(): Promise<Array<{ productId: string; count: number }>> {
  const products = await allProducts();
  return Promise.all(products.map(async (product) => ({
    productId: product.id,
    count: await countWp(wpConfig(), product.postId),
  })));
}

export const postComment = (productId: string, author: string, body: string): Promise<CommentResult> =>
  createComment(wpConfig(), postIdOf(productId), author, body);

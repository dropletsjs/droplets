import { json, type RequestHandler } from "$droplets/server";
import { commentsProps } from "../../lib/schemas.ts";
import { commentsPage, countComments } from "../../lib/server/comments.ts";
import { query } from "../../lib/server/http.ts";

/**
 * `GET /api/comments?productId=p_…&order=oldest|newest&page=1&showing=10`
 * → `{ comments, total, pageCount, page }`. Page-based, as the droplet's
 * props; product-comments reads the total here after hydrating, since its
 * prerendered markup leaves it out. Public: a short shared cache is fine.
 */
export const GET: RequestHandler = async ({ url }) => {
  const props = await query(url, commentsProps);
  const [comments, total] = await Promise.all([commentsPage(props), countComments(props.productId)]);
  return json(
    { comments, total, page: props.page, pageCount: Math.max(1, Math.ceil(total / props.showing)) },
    { headers: { "cache-control": "public, max-age=5" } },
  );
};

import { error, json, type RequestHandler } from "$droplets/server";
import { randomTestimonials, readTestimonialsQuery, testimonialsPage } from "../../lib/server/testimonials.ts";

/**
 * `GET /api/testimonials?max=N&random=true` → `{ testimonials }`, N random
 * distinct items (1–100, default 10), never cached; `?page=P` →
 * `{ page, pages, testimonials }`, ten per page (1–10), cached five
 * minutes. Any other query is a 400.
 */
export const GET: RequestHandler = ({ url }) => {
  const query = readTestimonialsQuery(url.searchParams);
  if (query.mode === "invalid") error(400, query.message);
  if (query.mode === "page") {
    return json(testimonialsPage(query.page), { headers: { "cache-control": "public, max-age=300" } });
  }
  return json(randomTestimonials(query.max), { headers: { "cache-control": "no-store" } });
};

import { json, type RequestHandler } from "$droplets/server";

/**
 * `GET /api/auth/me` → `{ admin: { name } | null }`: the WordPress admin the
 * plugin vouched for on this request (`x-wp-shop-user`), else `null`.
 */
export const GET: RequestHandler = ({ locals }) => json({ admin: locals.admin ? { name: locals.admin.name } : null });

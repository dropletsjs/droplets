import { json, type RequestHandler } from "$droplets/server";

/**
 * `GET /api/auth/me` → `{ admin: { name } | null }` from the `shop_admin`
 * cookie. A host may call it server-side to send `/admin` to `/login`
 * first; the admin droplet renders its own gate either way.
 */
export const GET: RequestHandler = ({ locals }) => json({ admin: locals.admin });

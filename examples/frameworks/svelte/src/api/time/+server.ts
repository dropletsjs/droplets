import { json, type RequestHandler } from "$droplets/server";

/** `GET /api/time` -> `{ "now": "2026-11-09T10:00:00.000Z" }`. */
export const GET: RequestHandler = () => json({ now: new Date().toISOString() });

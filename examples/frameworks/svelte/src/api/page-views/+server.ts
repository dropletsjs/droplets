import { json, type RequestHandler } from "$droplets/server";
import { pageName, type PageViews } from "../../lib/page-views.ts";
import { countView, viewsOf } from "../../lib/server/page-views.ts";

/** Larger than any `{ "page": "<64 characters>" }`; anything bigger is refused unread. */
const MAX_BODY = 256;

/** A plain `{ … }` object, as `JSON.parse` makes: no array, no other prototype. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

/** `GET /api/page-views?page=pricing` -> `{ "page": "pricing", "views": 3 }`. */
export const GET: RequestHandler = ({ url }) => {
  const page = pageName(url.searchParams.get("page"));
  if (!page) return json({ message: "page: a slug, such as pricing" }, { status: 400 });
  return json({ page, views: viewsOf(page) } satisfies PageViews);
};

/**
 * `POST /api/page-views` with `{ "page": "pricing" }` -> the page's new
 * `{ page, views }`. What the page-views droplet's script sends. The body
 * is plain data: JSON, one object, one own `page` field that is a slug.
 * Nothing in it decides what code runs.
 */
export const POST: RequestHandler = async ({ request }) => {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return json({ message: "send application/json" }, { status: 415 });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return json({ message: "body too large" }, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ message: "body too large" }, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ message: "body: JSON" }, { status: 400 });
  }
  const fields = isPlainObject(body) ? body : null;
  const page = fields && Object.hasOwn(fields, "page") ? pageName(fields["page"]) : null;
  if (!page) return json({ message: "body: { page }, page a slug such as pricing" }, { status: 400 });

  const views = countView(page);
  if (views === null) return json({ message: "too many pages" }, { status: 507 });
  return json({ page, views } satisfies PageViews);
};

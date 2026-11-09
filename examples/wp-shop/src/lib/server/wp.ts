import * as z from "zod/mini";
import { CATEGORY_SLUGS } from "../categories.ts";
import { SLUG } from "../schemas.ts";
import type { Comment, CommentOrder } from "../types.ts";
import { type HostAdmin, MAX_LIFETIME_S, SERVICE_HEADER, secretPair, signAssertion } from "./host-identity.ts";
import { plainLine, plainText } from "./text.ts";

/**
 * WordPress's REST API, the only place wp-shop's catalogue and comments
 * come from. Every answer is untrusted input, like a request body:
 *
 * - no redirect is followed, a slow answer is cut off, and only a JSON
 *   answer of at most MAX_RESPONSE_BYTES is read (`Content-Length`, then
 *   counted while it streams);
 * - plain `JSON.parse`, then each item through a schema that names every
 *   field it keeps, with its type, range and length; zod builds a new
 *   object of those fields only, so nothing else of the answer (a
 *   `__proto__` key included) gets into wp-shop's objects;
 * - an item out of shape is left out and logged, never "fixed"; an answer
 *   that is not a list where a list is due, or an error, throws;
 * - HTML (`title.rendered`, `content.rendered`) becomes text
 *   (lib/server/text.ts) and an image must be a Media Library URL on
 *   WP_PUBLIC_URL.
 *
 * The routes: `wp/v2/products` (the plugin's `product` post type, with
 * `show_in_rest`), `wp/v2/media`, `wp/v2/comments`. Writes (stock and
 * price, a comment) go to the same routes; see `updateProduct`.
 */

export type WpConfig = {
  /** How wp-shop reaches WordPress: `http://wordpress`. */
  internalUrl: string;
  /** WordPress's public origin: images must be on it. */
  publicUrl: string;
  /** WP_SHOP_SERVICE_SECRET: signs the writes back. */
  serviceSecret?: string | undefined;
  /** WP_SHOP_HOST_SECRET, only to refuse a service secret equal to it. */
  hostSecret?: string | undefined;
  /** Per request; default 5 s. */
  timeoutMs?: number;
};

/** WordPress did not answer as it should: the droplet's error page, never a guess. */
export class WordPressError extends Error {
  override name = "WordPressError";
}

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PER_PAGE = 100;
/** At most this many pages of 100 products: a demo-sized catalogue. */
const MAX_PAGES = 10;

const PRODUCT_FIELDS = "id,slug,status,date_gmt,title,content,featured_media,meta";
const COMMENT_FIELDS = "id,post,author_name,date_gmt,content,status";

// ---- Reading an answer -----------------------------------------------------

async function readCapped(response: Response, max: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > max) {
    await response.body?.cancel();
    throw new WordPressError(`answer of ${declared} bytes, over ${max}`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new WordPressError(`answer over ${max} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

type Answer = { status: number; headers: Headers; body: unknown };

/** One REST call: `path` under `/wp-json/`, JSON in and out. */
async function call(
  config: WpConfig,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Answer> {
  if (!path.startsWith("/wp-json/")) throw new WordPressError(`not a REST path: ${path}`);
  const url = `${config.internalUrl.replace(/\/+$/, "")}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(config.timeoutMs ?? 5000),
      headers: {
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (error) {
    throw new WordPressError(`${path}: unreachable (${(error as Error).message})`);
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new WordPressError(`${path}: redirected (HTTP ${response.status}); is the plugin active?`);
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    await response.body?.cancel();
    throw new WordPressError(`${path}: HTTP ${response.status}, not JSON`);
  }
  const text = await readCapped(response, MAX_RESPONSE_BYTES);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new WordPressError(`${path}: HTTP ${response.status}, invalid JSON`);
  }
  return { status: response.status, headers: response.headers, body };
}

/** A whole number from a header (`X-WP-Total`), or `null`. */
function headerCount(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  return value && /^\d{1,7}$/.test(value) ? Number(value) : null;
}

/** A WordPress error answer's `code`, when it has one. */
function errorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body) || !Object.hasOwn(body, "code")) return null;
  const code = (body as Record<string, unknown>)["code"];
  return typeof code === "string" && code.length <= 80 ? code : null;
}

// ---- Schemas: what wp-shop keeps of an answer ------------------------------

const whole = (min: number, max: number) => z.number().check(z.int(), z.minimum(min), z.maximum(max));
const rendered = (max: number) => z.object({ rendered: z.string().check(z.maxLength(max)) });
/** `date_gmt`: `2026-11-03T10:00:00`, UTC without the zone. */
const gmt = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/));
const postId = whole(1, 9_999_999_999);

/** A `product` post as the REST API answers it, with the plugin's meta. */
export const wpProduct = z.object({
  id: postId,
  slug: z.string().check(z.maxLength(80), z.regex(SLUG)),
  status: z.literal("publish"),
  date_gmt: gmt,
  title: rendered(400),
  content: rendered(20_000),
  featured_media: whole(0, 9_999_999_999),
  meta: z.object({
    shop_price_cents: whole(1, 10_000_000),
    shop_stock: whole(0, 99_999),
    shop_sale_pct: whole(0, 90),
    shop_category: z.enum(CATEGORY_SLUGS),
    shop_details: z.string().check(z.maxLength(400)),
  }),
});
export type WpProductAnswer = z.output<typeof wpProduct>;

export const wpMedia = z.object({ id: postId, source_url: z.string().check(z.maxLength(500)) });

export const wpComment = z.object({
  id: postId,
  post: postId,
  author_name: z.string().check(z.maxLength(245)),
  date_gmt: gmt,
  content: rendered(10_000),
  status: z.optional(z.string().check(z.maxLength(20))),
});

/** What wp-shop makes of a product post: checked, text, cents. */
export type WpProduct = {
  postId: number;
  /** `p_<post id>`: the id the shop's forms and API use. */
  id: string;
  slug: string;
  name: string;
  description: string;
  details: string[];
  priceCents: number;
  /** The campaign's discount on it, 0 for none. */
  salePct: number;
  category: string;
  stock: number;
  /** Its featured image's URL in the Media Library. */
  image: string;
  /** ISO 8601. */
  createdAt: string;
};

const warned = new Set<string>();

/** Logs an item left out, once per item and reason. */
function leftOut(what: string, item: unknown, reason: string) {
  const id = typeof item === "object" && item !== null && Object.hasOwn(item, "id") ? String((item as { id: unknown }).id).slice(0, 20) : "?";
  const key = `${what}:${id}:${reason}`;
  if (warned.has(key) || warned.size > 1000) return;
  warned.add(key);
  console.warn(`[wp-shop] WordPress ${what} ${id} left out: ${reason}`);
}

const issue = (error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }) => {
  const [first] = error.issues;
  return `${(first?.path ?? []).map(String).join(".") || "item"}: ${first?.message ?? "invalid"}`;
};

/** An answer that must be a list of at most `max` items. */
function list(body: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(body)) throw new WordPressError(`${path}: not a list`);
  if (body.length > max) throw new WordPressError(`${path}: ${body.length} items, over ${max}`);
  return body;
}

const UPLOADS = /^\/wp-content\/uploads\/[A-Za-z0-9/_.-]{1,250}\.(?:webp|png|jpe?g)$/;

/** A Media Library URL on WordPress's public origin, or `null`. */
export function mediaUrl(sourceUrl: string, publicUrl: string): string | null {
  let url: URL;
  let origin: string;
  try {
    url = new URL(sourceUrl);
    origin = new URL(publicUrl).origin;
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== origin || url.username || url.password || url.search || url.hash) return null;
  if (!UPLOADS.test(url.pathname) || url.pathname.includes("..")) return null;
  return url.href;
}

/** A product post and its image's URL as wp-shop's product; `null` when its image is not usable. */
export function toProduct(post: WpProductAnswer, image: string | null): WpProduct | null {
  if (!image) return null;
  const name = plainLine(post.title.rendered, 80);
  if (name.length < 2) return null;
  return {
    postId: post.id,
    id: `p_${post.id}`,
    slug: post.slug,
    name,
    description: plainText(post.content.rendered, 2000),
    details: post.meta.shop_details.split("·").map((part) => part.trim().slice(0, 80)).filter(Boolean).slice(0, 8),
    priceCents: post.meta.shop_price_cents,
    salePct: post.meta.shop_sale_pct,
    category: post.meta.shop_category,
    stock: post.meta.shop_stock,
    image,
    createdAt: `${post.date_gmt}.000Z`,
  };
}

// ---- Reads -------------------------------------------------------------------

/** The image URLs of these attachments, by id; ones out of shape are left out. */
async function mediaUrls(config: WpConfig, ids: number[]): Promise<Map<number, string>> {
  const urls = new Map<number, string>();
  const unique = [...new Set(ids.filter((id) => id > 0))];
  for (let at = 0; at < unique.length; at += PER_PAGE) {
    const chunk = unique.slice(at, at + PER_PAGE);
    const path = `/wp-json/wp/v2/media?include=${chunk.join(",")}&per_page=${PER_PAGE}&_fields=id,source_url`;
    const answer = await call(config, path);
    if (answer.status !== 200) throw new WordPressError(`${path}: HTTP ${answer.status}`);
    for (const item of list(answer.body, path, PER_PAGE)) {
      const media = wpMedia.safeParse(item);
      if (!media.success) {
        leftOut("media", item, issue(media.error));
        continue;
      }
      const url = mediaUrl(media.data.source_url, config.publicUrl);
      if (url) urls.set(media.data.id, url);
      else leftOut("media", item, "not a Media Library URL on WP_PUBLIC_URL");
    }
  }
  return urls;
}

/** Product posts, checked, with their images; ones out of shape left out. */
async function withImages(config: WpConfig, items: unknown[]): Promise<WpProduct[]> {
  const posts: WpProductAnswer[] = [];
  for (const item of items) {
    const post = wpProduct.safeParse(item);
    if (post.success) posts.push(post.data);
    else leftOut("product", item, issue(post.error));
  }
  const images = await mediaUrls(config, posts.map((post) => post.featured_media));
  return posts.flatMap((post) => {
    const product = toProduct(post, images.get(post.featured_media) ?? null);
    if (!product) leftOut("product", post, "no usable featured image or title");
    return product ? [product] : [];
  });
}

/** Every published product, newest first. */
export async function fetchProducts(config: WpConfig): Promise<WpProduct[]> {
  const items: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const path = `/wp-json/wp/v2/products?per_page=${PER_PAGE}&page=${page}&orderby=date&order=desc&_fields=${PRODUCT_FIELDS}`;
    const answer = await call(config, path);
    if (answer.status !== 200) throw new WordPressError(`${path}: HTTP ${answer.status}`);
    items.push(...list(answer.body, path, PER_PAGE));
    const pages = headerCount(answer.headers, "x-wp-totalpages") ?? 1;
    if (page >= pages) break;
  }
  return withImages(config, items);
}

/** One page of a product's approved comments, oldest or newest first. */
export async function fetchComments(
  config: WpConfig,
  post: number,
  { order, page, showing }: { order: CommentOrder; page: number; showing: number },
): Promise<Comment[]> {
  const direction = order === "oldest" ? "asc" : "desc";
  const path = `/wp-json/wp/v2/comments?post=${post}&orderby=date_gmt&order=${direction}&per_page=${showing}&page=${page}&_fields=${COMMENT_FIELDS}`;
  const answer = await call(config, path);
  // Past the last page WordPress answers 400: an empty page.
  if (answer.status === 400 && errorCode(answer.body) === "rest_comment_invalid_page_number") return [];
  if (answer.status !== 200) throw new WordPressError(`${path}: HTTP ${answer.status}`);
  return list(answer.body, path, showing).flatMap((item) => {
    const comment = wpComment.safeParse(item);
    if (!comment.success || comment.data.post !== post) {
      leftOut("comment", item, comment.success ? "another post's" : issue(comment.error));
      return [];
    }
    const author = plainLine(comment.data.author_name, 40) || "Anonymous";
    const body = plainText(comment.data.content.rendered, 1000);
    return body ? [{ id: `c_${comment.data.id}`, author, body, createdAt: `${comment.data.date_gmt}.000Z` }] : [];
  });
}

/** How many approved comments a product has: WordPress's `X-WP-Total`. */
export async function countComments(config: WpConfig, post: number): Promise<number> {
  const path = `/wp-json/wp/v2/comments?post=${post}&per_page=1&_fields=id`;
  const answer = await call(config, path);
  if (answer.status !== 200) throw new WordPressError(`${path}: HTTP ${answer.status}`);
  const total = headerCount(answer.headers, "x-wp-total");
  if (total === null) throw new WordPressError(`${path}: no X-WP-Total`);
  return total;
}

/** Whether WordPress answers the product route: WordPress is up and the plugin active. */
export async function wordpressReady(config: WpConfig): Promise<boolean> {
  try {
    const answer = await call(config, "/wp-json/wp/v2/products?per_page=1&_fields=id");
    return answer.status === 200 && Array.isArray(answer.body);
  } catch {
    return false;
  }
}

// ---- Writes ------------------------------------------------------------------

/**
 * Sets a product's stock and price, as the WordPress admin behind the
 * request. wp-shop holds no WordPress password: the write carries
 * `x-wp-shop-service`, an assertion like the plugin's, signed with
 * WP_SHOP_SERVICE_SECRET (never WP_SHOP_HOST_SECRET: equal ones are
 * refused), for `aud: "wordpress"`, this one method and path, 60 s. The
 * plugin checks it in `determine_current_user`, on this route only
 * (`POST /wp-json/wp/v2/products/<id>`), and runs the request as that user
 * (who must still be able to `manage_options`); WordPress's own checks
 * (`edit_post`, the meta's schema) apply as for any REST write.
 */
export async function updateProduct(
  config: WpConfig,
  admin: HostAdmin,
  post: number,
  meta: { shop_stock: number; shop_price_cents: number },
): Promise<WpProduct> {
  const { service: secret, error } = secretPair(config.hostSecret, config.serviceSecret);
  if (error) throw new WordPressError(error);
  if (!secret) throw new WordPressError("WP_SHOP_SERVICE_SECRET is not set (32+ bytes): wp-shop cannot write to WordPress");
  const path = `/wp-json/wp/v2/products/${post}?_fields=${PRODUCT_FIELDS}`;
  const assertion = await signAssertion(
    { sub: admin.name, role: admin.role, exp: Math.floor(Date.now() / 1000) + MAX_LIFETIME_S, method: "POST", path, aud: "wordpress" },
    secret,
  );
  const answer = await call(config, path, {
    method: "POST",
    body: { meta },
    headers: { [SERVICE_HEADER]: assertion },
  });
  if (answer.status !== 200) throw new WordPressError(`${path}: HTTP ${answer.status} (${errorCode(answer.body) ?? "no code"})`);
  const [product] = await withImages(config, [answer.body]);
  if (!product) throw new WordPressError(`${path}: the answer is not a product`);
  return product;
}

export type CommentResult = { ok: true; held: boolean } | { ok: false; reason: "flood" | "duplicate" | "closed" | "refused" };

/**
 * Posts a visitor's comment, anonymously: the plugin allows anonymous REST
 * comments on products (`rest_allow_anonymous_comments`), and WordPress
 * applies its own rules (moderation, flood, duplicates) as to any comment.
 */
export async function createComment(config: WpConfig, post: number, author: string, content: string): Promise<CommentResult> {
  const answer = await call(config, `/wp-json/wp/v2/comments?_fields=${COMMENT_FIELDS}`, {
    method: "POST",
    body: { post, author_name: author, content },
  });
  if (answer.status === 201) {
    const comment = wpComment.safeParse(answer.body);
    return { ok: true, held: !comment.success || comment.data.status !== "approved" };
  }
  const code = errorCode(answer.body);
  if (code === "comment_flood") return { ok: false, reason: "flood" };
  if (code === "comment_duplicate") return { ok: false, reason: "duplicate" };
  if (code === "rest_comment_closed") return { ok: false, reason: "closed" };
  return { ok: false, reason: "refused" };
}

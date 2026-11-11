import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { SERVICE_HEADER, verifyAssertion } from "../src/lib/server/host-identity.ts";

/**
 * A stand-in for WordPress's REST API, as the Droplets Embed plugin sets it
 * up: `wp/v2/products` (with the shop's meta), `wp/v2/media`,
 * `wp/v2/comments`, and writes signed with `x-wp-shop-service` (keyed with
 * WP_SHOP_SERVICE_SECRET). Enough for
 * wp-shop to build and run against it; `override` makes one path answer
 * anything, for the malformed-answer tests.
 */
export type MockProduct = {
  id: number;
  slug: string;
  title: string;
  content: string;
  date: string;
  media: number;
  meta: { shop_price_cents: number; shop_stock: number; shop_sale_pct: number; shop_category: string; shop_details: string };
};
export type MockComment = { id: number; post: number; author_name: string; content: string; date: string };
type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const DAY = 24 * 60 * 60 * 1000;
const gmt = (ms: number) => new Date(ms).toISOString().slice(0, 19);

/** Six products in three categories; the first has 23 comments, the second 3. */
export function fixtures(now = Date.now()) {
  const names = [
    ["clay-cylinder-mug", "Clay Cylinder Mug", "mugs"],
    ["double-wall-tumbler", "Double-Wall Tumbler", "mugs"],
    ["speckled-temple-cup", "Speckled Temple Cup", "mugs"],
    ["linen-notebook", "Linen Notebook", "desk"],
    ["brass-pen-holder", "Brass Pen Holder", "desk"],
    ["canvas-urban-tote", "Canvas Urban Tote", "bags"],
  ] as const;
  const products: MockProduct[] = names.map(([slug, title, category], i) => ({
    id: 10 + i,
    slug,
    title,
    content: `<p>The ${title.toLowerCase()} you&#8217;ll keep.</p>\n<p>Second paragraph &amp; more.</p>\n`,
    date: gmt(now - (30 + i * 5) * DAY),
    media: 100 + i,
    meta: {
      shop_price_cents: 1200 + i * 300,
      shop_stock: [12, 3, 0, 25, 8, 40][i]!,
      shop_sale_pct: i === 0 ? 20 : 0,
      shop_category: category,
      shop_details: "300 ml · Stoneware",
    },
  }));
  const comments: MockComment[] = [];
  let id = 500;
  for (const [post, count] of [
    [10, 23],
    [11, 3],
  ] as const) {
    for (let n = 0; n < count; n++) {
      comments.push({
        id: id++,
        post,
        author_name: `Reader ${n + 1}`,
        content: `<p>Comment ${n + 1} on ${post}.</p>\n`,
        date: gmt(now - (100 - n) * DAY),
      });
    }
  }
  return { products, comments };
}

export async function startMockWordPress(options: { serviceSecret: string }) {
  const state = fixtures();
  const overrides = new Map<string, Handler>();
  const writes: Array<{ user: string; post: number; meta: unknown }> = [];
  let origin = "";

  const send = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    response.writeHead(status, { "content-type": "application/json; charset=UTF-8", ...headers });
    response.end(JSON.stringify(body));
  };
  const productJson = (p: MockProduct) => ({
    id: p.id,
    slug: p.slug,
    status: "publish",
    date_gmt: p.date,
    title: { rendered: p.title },
    content: { rendered: p.content, protected: false },
    featured_media: p.media,
    meta: { ...p.meta },
  });
  const readBody = (request: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => resolve(body));
    });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", origin);
    const override = overrides.get(url.pathname);
    if (override) return override(request, response);
    const query = url.searchParams;

    if (request.method === "GET" && url.pathname === "/wp-json/wp/v2/products") {
      const perPage = Number(query.get("per_page") ?? 10);
      const page = Number(query.get("page") ?? 1);
      const sorted = [...state.products].sort((a, b) => b.date.localeCompare(a.date));
      const items = sorted.slice((page - 1) * perPage, page * perPage).map(productJson);
      return send(response, 200, items, {
        "x-wp-total": String(sorted.length),
        "x-wp-totalpages": String(Math.ceil(sorted.length / perPage)),
      });
    }
    if (request.method === "GET" && url.pathname === "/wp-json/wp/v2/media") {
      const ids = (query.get("include") ?? "").split(",").map(Number);
      return send(
        response,
        200,
        ids.map((id) => ({ id, source_url: `${origin}/wp-content/uploads/2026/11/m-${id}.webp` })),
      );
    }
    if (request.method === "GET" && url.pathname === "/wp-json/wp/v2/comments") {
      const post = Number(query.get("post"));
      const perPage = Number(query.get("per_page") ?? 10);
      const page = Number(query.get("page") ?? 1);
      const asc = query.get("order") === "asc";
      const all = state.comments
        .filter((c) => c.post === post)
        .sort((a, b) => (asc ? 1 : -1) * (a.date.localeCompare(b.date) || a.id - b.id));
      const pages = Math.ceil(all.length / perPage);
      if (all.length && page > pages) return send(response, 400, { code: "rest_comment_invalid_page_number", message: "…" });
      const items = all.slice((page - 1) * perPage, page * perPage).map((c) => ({
        id: c.id,
        post: c.post,
        author_name: c.author_name,
        date_gmt: c.date,
        content: { rendered: c.content },
        status: "approved",
      }));
      return send(response, 200, items, { "x-wp-total": String(all.length), "x-wp-totalpages": String(pages) });
    }
    if (request.method === "POST" && url.pathname === "/wp-json/wp/v2/comments") {
      const body = JSON.parse(await readBody(request)) as { post: number; author_name: string; content: string };
      const comment = {
        id: 9000 + state.comments.length,
        post: body.post,
        author_name: body.author_name,
        content: `<p>${body.content}</p>`,
        date: gmt(Date.now()),
      };
      state.comments.push(comment);
      return send(response, 201, {
        id: comment.id,
        post: comment.post,
        author_name: comment.author_name,
        date_gmt: comment.date,
        content: { rendered: comment.content },
        status: "approved",
      });
    }
    const write = /^\/wp-json\/wp\/v2\/products\/(\d+)$/.exec(url.pathname);
    if (request.method === "POST" && write) {
      // As the plugin's `determine_current_user`: the signed header, or nobody.
      const claims = await verifyAssertion(request.headers[SERVICE_HEADER] as string | undefined, options.serviceSecret, {
        aud: "wordpress",
        method: "POST",
        path: `${url.pathname}${url.search}`,
      });
      if (!claims) return send(response, 401, { code: "rest_cannot_edit", message: "Sorry, you are not allowed to edit this post." });
      const product = state.products.find((p) => p.id === Number(write[1]));
      if (!product) return send(response, 404, { code: "rest_post_invalid_id" });
      const { meta } = JSON.parse(await readBody(request)) as { meta: Partial<MockProduct["meta"]> };
      Object.assign(product.meta, meta);
      writes.push({ user: claims.sub, post: product.id, meta });
      return send(response, 200, productJson(product));
    }
    send(response, 404, { code: "rest_no_route", message: "No route was found matching the URL and request method." });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url: origin,
    state,
    writes,
    /** `path` answers with `handler` until `reset()`. */
    override: (path: string, handler: Handler) => overrides.set(path, handler),
    reset: () => overrides.clear(),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type MockWordPress = Awaited<ReturnType<typeof startMockWordPress>>;

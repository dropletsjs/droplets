import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { commentEntries } from "../src/lib/comment-entries.ts";
import { fillLive, liveToken, type LiveValues } from "../src/lib/live.ts";
import { PRODUCT_ID } from "../src/lib/schemas.ts";
import {
  type Claims,
  MAX_ASSERTION_BYTES,
  SAME_SECRETS,
  secretPair,
  signAssertion,
  verifyAssertion,
} from "../src/lib/server/host-identity.ts";
import { plainLine, plainText } from "../src/lib/server/text.ts";
import { countComments, fetchComments, fetchProducts, mediaUrl, updateProduct, type WpConfig } from "../src/lib/server/wp.ts";
import { startMockWordPress, type MockWordPress } from "./mock-wordpress.ts";

const SECRET = "test-host-secret-0123456789abcdef-0123456789";
const SERVICE_SECRET = "test-service-secret-0123456789abcdef-01234567";

// ---- The assertion: x-wp-shop-user ------------------------------------------

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const claims = (over: Partial<Claims> = {}): Claims => ({
  sub: "admin",
  role: "administrator",
  exp: NOW / 1000 + 60,
  method: "POST",
  path: "/droplets/product-admin?/save",
  aud: "wp-shop",
  ...over,
});
const expected = { aud: "wp-shop" as const, method: "POST", path: "/droplets/product-admin?/save", now: NOW };

const b64 = (text: string) => Buffer.from(text).toString("base64url");
/** Signs any payload text, the way the plugin does: HMAC-SHA256 over the base64url payload. */
const signRaw = (json: string, secret = SECRET) => {
  const payload = b64(json);
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
};

describe("x-wp-shop-user, the host-asserted identity", () => {
  it("names the WordPress admin for the one request it was made for", async () => {
    const header = await signAssertion(claims(), SECRET);
    expect(await verifyAssertion(header, SECRET, expected)).toEqual(claims());
    // The plugin's PHP signs the same way.
    expect(await verifyAssertion(signRaw(JSON.stringify(claims())), SECRET, expected)).toEqual(claims());
  });

  it("refuses a tampered payload", async () => {
    const [, mac] = (await signAssertion(claims(), SECRET)).split(".");
    const forged = `${b64(JSON.stringify(claims({ sub: "someone-else" })))}.${mac}`;
    expect(await verifyAssertion(forged, SECRET, expected)).toBeNull();
  });

  it("refuses a tampered MAC, and one made with another secret", async () => {
    const [payload, mac] = (await signAssertion(claims(), SECRET)).split(".") as [string, string];
    const flipped = `${mac.slice(0, -2)}${mac.at(-2) === "A" ? "B" : "A"}${mac.at(-1)}`;
    expect(await verifyAssertion(`${payload}.${flipped}`, SECRET, expected)).toBeNull();
    expect(await verifyAssertion(await signAssertion(claims(), `${SECRET}-other`), SECRET, expected)).toBeNull();
  });

  it("refuses an expired one, and one that lives longer than 60 s", async () => {
    expect(await verifyAssertion(await signAssertion(claims({ exp: NOW / 1000 }), SECRET), SECRET, expected)).toBeNull();
    expect(await verifyAssertion(await signAssertion(claims({ exp: NOW / 1000 - 1 }), SECRET), SECRET, expected)).toBeNull();
    expect(await verifyAssertion(await signAssertion(claims({ exp: NOW / 1000 + 3600 }), SECRET), SECRET, expected)).toBeNull();
    expect(await verifyAssertion(await signAssertion(claims({ exp: NOW / 1000 + 0.5 }), SECRET), SECRET, expected)).toBeNull();
  });

  it("refuses the wrong method", async () => {
    const header = await signAssertion(claims({ method: "GET" }), SECRET);
    expect(await verifyAssertion(header, SECRET, expected)).toBeNull();
  });

  it("refuses the wrong path, the query included", async () => {
    for (const path of ["/droplets/product-admin?/delete", "/droplets/product-admin", "/api/cart", "//elsewhere"]) {
      expect(await verifyAssertion(await signAssertion(claims({ path }), SECRET), SECRET, expected)).toBeNull();
    }
  });

  it("refuses one meant for the other direction (aud)", async () => {
    const back = await signAssertion(claims({ aud: "wordpress" }), SECRET);
    expect(await verifyAssertion(back, SECRET, expected)).toBeNull();
  });

  it("refuses an oversize header before looking at it", async () => {
    const header = await signAssertion(
      claims({ sub: "admin", path: `/droplets/product-admin?x=${"a".repeat(MAX_ASSERTION_BYTES)}` }),
      SECRET,
    );
    expect(header.length).toBeGreaterThan(MAX_ASSERTION_BYTES);
    expect(await verifyAssertion(header, SECRET, { ...expected, path: claims().path })).toBeNull();
  });

  it("takes __proto__ as data, never as a prototype or a claim", async () => {
    // A validly signed payload whose role comes only through __proto__.
    const { role: _role, ...rest } = claims();
    const inherited = signRaw(`{"__proto__":{"role":"administrator"},${JSON.stringify(rest).slice(1)}`);
    expect(await verifyAssertion(inherited, SECRET, expected)).toBeNull();
    // With every claim there and a __proto__ besides: the claims, and nothing polluted.
    const extra = signRaw(`{"__proto__":{"polluted":true},${JSON.stringify(claims()).slice(1)}`);
    const verified = await verifyAssertion(extra, SECRET, expected);
    expect(verified).toEqual(claims());
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf(verified)).toBe(Object.prototype);
  });

  it("refuses everything when no secret is configured, or a short one", async () => {
    const header = await signAssertion(claims(), SECRET);
    expect(await verifyAssertion(header, undefined, expected)).toBeNull();
    expect(await verifyAssertion(header, "", expected)).toBeNull();
    const short = "only-31-bytes-long-secret-01234";
    expect(await verifyAssertion(await signAssertion(claims(), short), short, expected)).toBeNull();
  });

  it("refuses what is not one: shapes, non-JSON, non-objects, wrong types", async () => {
    for (const header of [null, "", "abc", "a.b.c", `${b64("{}")}.!!`, "x".repeat(50)]) {
      expect(await verifyAssertion(header, SECRET, expected)).toBeNull();
    }
    for (const json of [
      "not json",
      "[1,2]",
      "null",
      '"admin"',
      JSON.stringify({ ...claims(), exp: "9999999999" }),
      JSON.stringify({ ...claims(), role: "editor" }),
      JSON.stringify({ ...claims(), sub: "<script>" }),
    ]) {
      expect(await verifyAssertion(signRaw(json), SECRET, expected)).toBeNull();
    }
  });
});

// ---- WordPress's REST answers, as untrusted input ---------------------------

describe("WordPress's REST answers", () => {
  let wp: MockWordPress;
  let config: WpConfig;
  beforeAll(async () => {
    wp = await startMockWordPress({ serviceSecret: SERVICE_SECRET });
    config = { internalUrl: wp.url, publicUrl: wp.url, hostSecret: SECRET, serviceSecret: SERVICE_SECRET };
  });
  afterEach(() => wp.reset());
  afterAll(() => wp.close());

  const answer =
    (body: string, status = 200, headers: Record<string, string> = { "content-type": "application/json" }) =>
    (_request: unknown, response: import("node:http").ServerResponse) => {
      response.writeHead(status, headers);
      response.end(body);
    };

  it("reads products: text from the rendered HTML, the image from the Media Library", async () => {
    const products = await fetchProducts(config);
    expect(products).toHaveLength(6);
    const mug = products.find((p) => p.slug === "clay-cylinder-mug")!;
    expect(mug).toMatchObject({
      id: "p_10",
      postId: 10,
      name: "Clay Cylinder Mug",
      priceCents: 1200,
      salePct: 20,
      category: "mugs",
      stock: 12,
    });
    expect(mug.description).toBe("The clay cylinder mug you’ll keep.\n\nSecond paragraph & more.");
    expect(mug.details).toEqual(["300 ml", "Stoneware"]);
    expect(mug.image).toBe(`${wp.url}/wp-content/uploads/2026/11/m-100.webp`);
    expect(PRODUCT_ID.test(mug.id)).toBe(true);
  });

  it("leaves out a product out of shape, and keeps only the fields it names", async () => {
    const good = (id: number, meta: Record<string, unknown> = {}) => ({
      id,
      slug: `p-${id}`,
      status: "publish",
      date_gmt: "2026-11-01T10:00:00",
      title: { rendered: `Product ${id}` },
      content: { rendered: "<p>Text.</p>" },
      featured_media: id,
      meta: { shop_price_cents: 1000, shop_stock: 1, shop_sale_pct: 0, shop_category: "desk", shop_details: "", ...meta },
    });
    const items = [
      good(1),
      good(2, { shop_price_cents: "1000" }),
      good(3, { shop_stock: -1 }),
      good(4, { shop_category: "weapons" }),
      good(5, { shop_sale_pct: 95 }),
      { ...good(6), slug: "../etc" },
      { ...good(7), status: "draft" },
      { ...good(8), title: { rendered: "x".repeat(5000) } },
      `{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"polluted":true}}}`,
    ];
    const body = `[${items.map((item) => (typeof item === "string" ? item : JSON.stringify({ ...item, extra: { injected: true } }))).join(",")}]`;
    wp.override("/wp-json/wp/v2/products", answer(body));
    const products = await fetchProducts(config);
    expect(products.map((p) => p.id)).toEqual(["p_1"]);
    expect(Object.keys(products[0]!).sort()).toEqual([
      "category",
      "createdAt",
      "description",
      "details",
      "id",
      "image",
      "name",
      "postId",
      "priceCents",
      "salePct",
      "slug",
      "stock",
    ]);
    expect(({} as Record<string, unknown>)["isAdmin"]).toBeUndefined();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("refuses an image that is not a Media Library URL on WordPress's public origin", () => {
    const base = "http://localhost:8008";
    expect(mediaUrl(`${base}/wp-content/uploads/2026/11/a.webp`, base)).toBe(`${base}/wp-content/uploads/2026/11/a.webp`);
    for (const url of [
      "http://evil.example/wp-content/uploads/a.webp",
      `${base}/wp-content/uploads/a.svg`,
      `${base}/wp-content/plugins/x.webp`,
      `${base}/wp-content/uploads/../../wp-config.webp`,
      `${base}/wp-content/uploads/a.webp?x=1`,
      "javascript:alert(1)//wp-content/uploads/a.webp",
      `http://user:pass@localhost:8008/wp-content/uploads/a.webp`,
    ])
      expect(mediaUrl(url, base), url).toBeNull();
  });

  it("leaves out a product whose image is on another origin", async () => {
    wp.override("/wp-json/wp/v2/media", answer(JSON.stringify([{ id: 100, source_url: "http://evil.example/wp-content/uploads/x.webp" }])));
    expect((await fetchProducts(config)).length).toBe(0);
  });

  it("throws on an answer that is not JSON, not a list, too large, or a redirect", async () => {
    const path = "/wp-json/wp/v2/products";
    for (const handler of [
      answer("<html>Error establishing a database connection</html>", 200, { "content-type": "text/html" }),
      answer("{not json", 200),
      answer(JSON.stringify({ code: "rest_no_route" }), 404),
      answer(JSON.stringify({ items: [] }), 200),
      answer(JSON.stringify(Array.from({ length: 101 }, () => ({}))), 200),
      answer("", 302, { location: "http://localhost:8008/wp-admin/install.php", "content-type": "application/json" }),
      answer(`[${" ".repeat(3 * 1024 * 1024)}]`, 200),
    ]) {
      wp.override(path, handler);
      await expect(fetchProducts(config)).rejects.toThrow();
    }
  });

  it("reads comments as text, leaves out another post's, and counts from X-WP-Total", async () => {
    const page = await fetchComments(config, 10, { order: "oldest", page: 1, showing: 10 });
    expect(page).toHaveLength(10);
    expect(page[0]).toMatchObject({ id: "c_500", author: "Reader 1", body: "Comment 1 on 10." });
    expect(await fetchComments(config, 10, { order: "oldest", page: 9, showing: 10 })).toEqual([]);
    expect(await countComments(config, 10)).toBe(23);

    wp.override(
      "/wp-json/wp/v2/comments",
      answer(
        JSON.stringify([
          { id: 1, post: 99, author_name: "Elsewhere", date_gmt: "2026-11-01T10:00:00", content: { rendered: "<p>Not this post.</p>" } },
          {
            id: 2,
            post: 10,
            author_name: "<b>Ana</b>",
            date_gmt: "2026-11-01T10:00:00",
            content: { rendered: "<p>&lt;script&gt;x&lt;/script&gt; fine</p>" },
          },
          { id: 3, post: 10, author_name: 7, date_gmt: "yesterday", content: "plain" },
        ]),
        200,
        { "content-type": "application/json" },
      ),
    );
    const odd = await fetchComments(config, 10, { order: "oldest", page: 1, showing: 10 });
    // Text, which the droplet escapes; never HTML pasted.
    expect(odd).toEqual([{ id: "c_2", author: "Ana", body: "<script>x</script> fine", createdAt: "2026-11-01T10:00:00.000Z" }]);
    await expect(countComments(config, 10)).rejects.toThrow(/X-WP-Total/);
  });

  it("writes stock and price as the admin, with an assertion WordPress checks", async () => {
    const admin = { name: "admin", role: "administrator" } as const;
    const saved = await updateProduct(config, admin, 11, { shop_stock: 0, shop_price_cents: 999 });
    expect(saved).toMatchObject({ id: "p_11", stock: 0, priceCents: 999 });
    expect(wp.writes.at(-1)).toEqual({ user: "admin", post: 11, meta: { shop_stock: 0, shop_price_cents: 999 } });
    // Another secret, the host's among them: WordPress refuses, and so the write throws.
    for (const serviceSecret of [`${SERVICE_SECRET}-other`, SECRET]) {
      await expect(
        updateProduct({ ...config, hostSecret: undefined, serviceSecret }, admin, 11, { shop_stock: 1, shop_price_cents: 999 }),
      ).rejects.toThrow(/401/);
    }
    await expect(
      updateProduct({ ...config, serviceSecret: undefined }, admin, 11, { shop_stock: 1, shop_price_cents: 999 }),
    ).rejects.toThrow(/WP_SHOP_SERVICE_SECRET is not set/);
    // The host secret alone is not a service secret.
    await expect(
      updateProduct({ ...config, serviceSecret: undefined, hostSecret: SERVICE_SECRET }, admin, 11, {
        shop_stock: 1,
        shop_price_cents: 999,
      }),
    ).rejects.toThrow(/WP_SHOP_SERVICE_SECRET is not set/);
  });

  it("refuses to sign a write when both secrets are the same value", async () => {
    const writes = wp.writes.length;
    await expect(
      updateProduct({ ...config, hostSecret: SERVICE_SECRET }, { name: "admin", role: "administrator" }, 11, {
        shop_stock: 1,
        shop_price_cents: 999,
      }),
    ).rejects.toThrow(SAME_SECRETS);
    expect(wp.writes.length).toBe(writes);
  });
});

describe("the two secrets", () => {
  it("are kept apart: one each way, each 32+ bytes", () => {
    expect(secretPair(SECRET, SERVICE_SECRET)).toEqual({ host: SECRET, service: SERVICE_SECRET, error: null });
    expect(secretPair(SECRET, "short")).toEqual({ host: SECRET, service: undefined, error: null });
    expect(secretPair(undefined, SERVICE_SECRET)).toEqual({ host: undefined, service: SERVICE_SECRET, error: null });
    expect(secretPair(undefined, undefined)).toEqual({ host: undefined, service: undefined, error: null });
  });

  it("are both refused when equal, with the reason", () => {
    expect(secretPair(SECRET, SECRET)).toEqual({ host: undefined, service: undefined, error: SAME_SECRETS });
    expect(SAME_SECRETS).toMatch(/WP_SHOP_HOST_SECRET and WP_SHOP_SERVICE_SECRET are the same value/);
  });

  it("do not stand in for each other: an x-wp-shop-user signed with the service secret is no admin", async () => {
    const header = await signAssertion(claims(), SERVICE_SECRET);
    expect(await verifyAssertion(header, SECRET, expected)).toBeNull();
  });
});

// ---- Text out of WordPress's HTML -------------------------------------------

describe("text out of rendered HTML", () => {
  it("keeps paragraphs, drops tags, decodes entities", () => {
    expect(plainText("<p>One &amp; two&#8230;</p>\n<p>Three<br />four</p>", 100)).toBe("One & two…\n\nThree four");
    expect(plainLine("Tom&#8217;s <em>Mug</em>", 80)).toBe("Tom’s Mug");
    expect(plainText("<p>&#0; &#x110000; &bogus;</p>", 100)).toBe("&#0; &#x110000; &bogus;");
    expect(plainText("x".repeat(100), 10)).toHaveLength(10);
  });
});

// ---- What the shop's droplets share with examples/shop ----------------------

describe("the product page's live fields and the comments' entries", () => {
  it("fills placeholders escaped, and prerenders only full oldest-first pages", () => {
    const values = { price: `"><script>` } as LiveValues;
    expect(fillLive(`<b>${liveToken("price")}</b>`, values)).toBe("<b>&#34;&#62;&#60;script&#62;</b>");
    const keys = commentEntries([
      { productId: "p_10", count: 23 },
      { productId: "p_11", count: 3 },
    ]).map(({ props }) => `${props.productId}:${props.showing}:${props.page}`);
    expect(keys).toEqual(["p_10:10:1", "p_10:10:2", "p_10:20:1"]);
  });
});

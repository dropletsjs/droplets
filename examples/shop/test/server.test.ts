import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { CardProduct } from "../src/lib/types.ts";

// The built server, driven in-process through its fetch handler, on a
// freshly seeded copy of the database. Run `pnpm build` first.
const root = fileURLToPath(new URL("..", import.meta.url));
const tmp = fileURLToPath(new URL(".tmp/", import.meta.url));
const ORIGIN = "http://localhost:8300";

let server: { fetch(request: Request): Promise<Response> };

beforeAll(async () => {
  if (!existsSync(`${root}dist/server.js`)) throw new Error("dist/server.js is missing: run `pnpm build` first");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  Object.assign(process.env, {
    SHOP_DATABASE: `${tmp}shop.db`,
    SHOP_UPLOADS: `${tmp}uploads`,
    SHOP_IMAGES: `${root}images`,
    ADMIN_USER: "admin",
    ADMIN_PASSWORD: "droplets",
    SHOP_SECRET: "test-secret-0123456789abcdef-0123456789",
    DROPLETS_SECRET: "test-droplets-secret-0123456789abcdef-0123",
    DROPLETS_LOG: "error",
  });
  execFileSync(process.execPath, ["scripts/seed.ts"], { cwd: root, env: process.env, stdio: "ignore" });
  server = (await import(`${root}dist/server.js`)).default;
});

type Init = RequestInit & { cookie?: string };

const call = (path: string, { cookie, headers, ...init }: Init = {}) =>
  server.fetch(
    new Request(`${ORIGIN}${path}`, {
      ...init,
      headers: { ...(cookie ? { cookie } : {}), ...(headers as Record<string, string>) },
    }),
  );

const getJson = async (path: string, init?: Init) => {
  const response = await call(path, init);
  return { status: response.status, body: await response.json() };
};

const postJson = (path: string, body: unknown, init: Init = {}) =>
  call(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, ...init });

/** A browser's form post: same origin, form body, the JSON answer. */
const action = (path: string, fields: Record<string, string>, init: Init = {}) =>
  call(path, {
    method: "POST",
    body: new URLSearchParams(fields),
    ...init,
    headers: { origin: ORIGIN, accept: "application/json", ...(init.headers as Record<string, string>) },
  });

/** `name=value` of a Set-Cookie, for the next request. */
const cookieOf = (response: Response, name: string) => {
  const line = response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return line?.split(";")[0];
};

const products = async (query = "") => (await getJson(`/api/products?limit=48${query}`)).body.items as CardProduct[];
const bySlug = async (slug: string) => (await products()).find((p) => p.slug === slug)!;

async function login() {
  const response = await action("/droplets/login?/login&next=/admin", { user: "admin", password: "droplets" });
  return cookieOf(response, "shop_admin")!;
}

describe("/api/products", () => {
  it("lists, filters and sorts by the price a visitor pays", async () => {
    const { status, body } = await getJson("/api/products");
    expect(status).toBe(200);
    expect(body.total).toBe(20);
    expect(body.items).toHaveLength(12);
    expect(body.nextCursor).toEqual(expect.any(String));

    const mugs = await products("&category=mugs");
    expect(mugs.length).toBe(5);
    expect(mugs.every((p) => p.category === "mugs")).toBe(true);

    const cheap = await products("&sort=price-asc");
    const paid = cheap.map((p) => p.salePriceCents ?? p.priceCents);
    expect(paid).toEqual([...paid].sort((a, b) => a - b));

    const sale = await products("&onSale=1");
    expect(sale.length).toBeGreaterThan(0);
    expect(sale.every((p) => p.salePriceCents !== null && p.badges.includes("sale"))).toBe(true);
  });

  it("pages with an opaque cursor", async () => {
    const first = await getJson("/api/products?limit=12");
    const second = await getJson(`/api/products?limit=12&cursor=${first.body.nextCursor}`);
    expect(second.body.items).toHaveLength(8);
    expect(second.body.nextCursor).toBeNull();
    const ids = new Set([...first.body.items, ...second.body.items].map((p: { id: string }) => p.id));
    expect(ids.size).toBe(20);
  });

  it("refuses what it cannot read", async () => {
    expect((await call("/api/products?sort=random")).status).toBe(400);
    expect((await call("/api/products?limit=1000")).status).toBe(400);
    expect((await call("/api/products?cursor=bm9wZQ")).status).toBe(400);
    expect((await call(`/api/products?q=${"x".repeat(300)}`)).status).toBe(400);
    // LIKE wildcards are searched for, not expanded.
    expect((await getJson("/api/products?q=%25")).body.total).toBe(0);
  });
});

describe("/api/stock/check", () => {
  it("answers stock and prices for up to 50 ids", async () => {
    const [a, b] = await products();
    const response = await postJson("/api/stock/check", { ids: [a!.id, b!.id, "p_unknown00"] });
    expect(response.status).toBe(200);
    const { items } = await response.json();
    expect(items.map((i: { id: string }) => i.id)).toEqual([a!.id, b!.id]);
    expect(items[0]).toMatchObject({ stock: a!.stock, stockState: a!.stockState, priceCents: a!.priceCents });
  });

  it("refuses more than 50, non-ids, non-arrays and non-JSON", async () => {
    const many = Array.from({ length: 51 }, (_, i) => `p_${String(i).padStart(6, "0")}`);
    expect((await postJson("/api/stock/check", { ids: many })).status).toBe(400);
    expect((await postJson("/api/stock/check", { ids: ["../x"] })).status).toBe(400);
    expect((await postJson("/api/stock/check", { ids: "p_abcdef" })).status).toBe(400);
    expect((await postJson("/api/stock/check", [1, 2])).status).toBe(400);
    expect(
      (await call("/api/stock/check", { method: "POST", body: "ids=1", headers: { "content-type": "text/plain" } })).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it("takes __proto__ as data, never as a prototype", async () => {
    const response = await call("/api/stock/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"__proto__":{"ids":["p_abcdef"],"polluted":1}}`,
    });
    expect(response.status).toBe(400);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("the cart", () => {
  it("reads as empty without a cookie, and creates none", async () => {
    const response = await call("/api/cart");
    expect(await response.json()).toEqual({ cart: { count: 0, totalCents: 0, currency: "EUR", items: [] } });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("adds through the library's ?/add action, with the cart_id cookie", async () => {
    const product = (await products()).find((p) => p.stockState !== "out")!;
    const response = await action("/droplets/product-library?/add", { productId: product.id });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: "success", status: 200, data: { added: product.id, name: product.name, count: 1 } });
    const cookie = cookieOf(response, "cart_id")!;
    expect(cookie).toMatch(/^cart_id=[0-9a-f-]{36}$/);
    expect(response.headers.getSetCookie()[0]).toMatch(/HttpOnly/i);

    // The same cart, one more: no new cookie.
    const again = await action(`/droplets/product-card?/add&slug=${product.slug}`, { productId: product.id, qty: "2" }, { cookie });
    expect((await again.json()).data.count).toBe(3);
    expect(cookieOf(again, "cart_id")).toBeUndefined();

    const { body } = await getJson("/api/cart", { cookie });
    expect(body.cart.count).toBe(3);
    expect(body.cart.items[0]).toMatchObject({ productId: product.id, qty: 3 });

    // The cart's own actions.
    const set = await action("/droplets/shopping-cart?/setQty", { productId: product.id, qty: "1" }, { cookie });
    expect((await set.json()).data.cart.count).toBe(1);
    const removed = await action("/droplets/shopping-cart?/remove", { productId: product.id }, { cookie });
    expect((await removed.json()).data.cart.count).toBe(0);
  });

  it("refuses sold-out products, bad quantities and bad ids", async () => {
    const out = (await products()).find((p) => p.stockState === "out")!;
    const sold = await action("/droplets/product-library?/add", { productId: out.id });
    expect(sold.status).toBe(409);
    expect((await sold.json()).data).toEqual({ reason: "out", productId: out.id });
    expect((await action("/droplets/product-library?/add", { productId: "x" })).status).toBe(400);
    const some = (await products())[0]!;
    expect((await action("/droplets/product-library?/add", { productId: some.id, qty: "1e3" })).status).toBe(400);
  });

  it("has a JSON twin for host SPAs", async () => {
    const product = (await products()).find((p) => p.stockState === "in")!;
    const added = await postJson("/api/cart/items", { productId: product.id, qty: 2 });
    expect(added.status).toBe(200);
    const cookie = cookieOf(added, "cart_id")!;
    expect((await added.json()).cart.count).toBe(2);
    const removed = await call(`/api/cart/items/${product.id}`, { method: "DELETE", cookie });
    expect((await removed.json()).cart.count).toBe(0);
    expect((await postJson("/api/cart/items", { productId: product.id, qty: 0 })).status).toBe(400);
    expect((await postJson("/api/cart/items", { productId: product.id, qty: "2" })).status).toBe(400);
  });

  it("refuses a form posted from another origin", async () => {
    const response = await action(
      "/droplets/product-library?/add",
      { productId: "p_abcdef" },
      {
        headers: { origin: "https://evil.example" },
      },
    );
    expect(response.status).toBe(403);
  });
});

describe("login", () => {
  it("fails without echoing what was typed", async () => {
    const response = await action("/droplets/login?/login", { user: "admin", password: "nope" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ type: "failure", status: 401, data: { message: "Wrong user or password." } });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("sets a signed HttpOnly cookie and redirects to next", async () => {
    const response = await action("/droplets/login?/login&next=/admin?view=campaign", { user: "admin", password: "droplets" });
    expect(await response.json()).toMatchObject({ type: "redirect", status: 303, location: `${ORIGIN}/admin?view=campaign` });
    const line = response.headers.getSetCookie()[0]!;
    expect(line).toMatch(/^shop_admin=admin\.\d{10}\.[\w-]{43};/);
    expect(line).toMatch(/HttpOnly/i);
    const cookie = cookieOf(response, "shop_admin")!;
    expect((await getJson("/api/auth/me", { cookie })).body).toEqual({ admin: { name: "admin" } });
  });

  it("never redirects off the host", async () => {
    const response = await action("/droplets/login?/login&next=//evil.example", { user: "admin", password: "droplets" });
    expect(response.status).toBe(400);
  });

  it("ignores a forged session", async () => {
    const cookie = (await login()).replace(/\.[\w-]{43}$/, `.${"A".repeat(43)}`);
    expect((await getJson("/api/auth/me", { cookie })).body).toEqual({ admin: null });
    expect((await getJson("/api/auth/me")).body).toEqual({ admin: null });
  });
});

describe("admin stock, and the product page's live fields", () => {
  it("refuses without a session", async () => {
    const product = await bySlug("clay-cylinder-mug");
    const response = await action("/droplets/product-admin?/stock", { id: product.id, stock: "0" });
    expect(response.status).toBe(401);
    expect((await response.json()).data.reason).toBe("login");
    expect((await bySlug("clay-cylinder-mug")).stock).toBe(product.stock);
  });

  it("renders the gate without a session, and the list with one", async () => {
    const gate = await (await call("/droplets/product-admin")).text();
    expect(gate).toContain("You need to log in");
    const list = await (await call("/droplets/product-admin", { cookie: await login() })).text();
    expect(list).toContain("Clay Cylinder Mug");
  });

  it("sets stock to 0, and the prerendered page shows it at once", async () => {
    const product = await bySlug("clay-cylinder-mug");
    // The gallery's link: the version the build prerendered.
    const page = async () => (await call(`/droplets/product-page?slug=clay-cylinder-mug&v=${product.v}`)).text();
    const before = await page();
    expect(before).toContain(`class="product state-in"`);
    expect(before).not.toContain("%live:");
    expect(before).not.toContain("%v:");
    const renderId = /data-render-id="(\w+)"/.exec(before)![1];

    const cookie = await login();
    const response = await action("/droplets/product-admin?/stock", { id: product.id, stock: "0" }, { cookie });
    expect(await response.json()).toEqual({ type: "success", status: 200, data: { saved: product.id, stock: 0 } });

    const after = await page();
    // Still the build's render (same render id), with today's stock in it.
    expect(/data-render-id="(\w+)"/.exec(after)![1]).toBe(renderId);
    expect(after).toContain(`class="product state-out"`);
    expect(after).toContain(`<p class="stock stock-out">Out of stock</p>`);
    expect(after).toMatch(/<button class="button primary" disabled>Out of stock<\/button>/);
    expect((await bySlug("clay-cylinder-mug")).stockState).toBe("out");
    // Stock is live: the page's version stays.
    expect((await bySlug("clay-cylinder-mug")).v).toBe(product.v);
  });

  it("is what the cart drawer's check sees: the cart's line ids alone, looked up now", async () => {
    const product = (await products()).find((p) => p.stockState === "in" && p.slug !== "clay-cylinder-mug")!;
    const added = await action("/droplets/product-library?/add", { productId: product.id });
    const cart = cookieOf(added, "cart_id")!;
    const lines = (await getJson("/api/cart", { cookie: cart })).body.cart.items as Array<{ productId: string }>;
    const ids = lines.map((line) => line.productId);
    expect(ids).toEqual([product.id]);
    const check = async () => (await (await postJson("/api/stock/check", { ids })).json()).items;
    expect((await check())[0]).toMatchObject({ id: product.id, stockState: product.stockState });

    const saved = await action("/droplets/product-admin?/stock", { id: product.id, stock: "0" }, { cookie: await login() });
    expect(saved.status).toBe(200);
    expect(await check()).toEqual([expect.objectContaining({ id: product.id, stock: 0, stockState: "out" })]);
    // A line's own fields are no part of the question: only ids are taken.
    expect((await postJson("/api/stock/check", { ids: [{ id: product.id, stock: 5 }] })).status).toBe(400);
  });

  it("validates the stock and the product id", async () => {
    const cookie = await login();
    const product = await bySlug("linen-notebook");
    expect((await action("/droplets/product-admin?/stock", { id: product.id, stock: "-1" }, { cookie })).status).toBe(400);
    expect((await action("/droplets/product-admin?/stock", { id: "nope", stock: "3" }, { cookie })).status).toBe(400);
    expect((await action("/droplets/product-admin?/stock", { id: "p_0000000000", stock: "3" }, { cookie })).status).toBe(404);
  });

  it("shows the campaign price and drops it when the campaign stops", async () => {
    const page = async () => (await call("/droplets/product-page?slug=clay-cylinder-mug")).text();
    expect(await page()).toContain(`<p class="price"><s>€24.00</s> <b>€19.20</b></p>`);
    const cookie = await login();
    const stop = await action("/droplets/product-admin?/campaignStop", { id: "c_autumn" }, { cookie });
    expect(stop.status).toBe(200);
    const after = await page();
    expect(after).toContain(`<p class="price"><s></s> <b>€24.00</b></p>`);
    expect(after).toContain(`<span class="badge sale" hidden>`);
  });

  it("answers a gone product with a notice, with v or without", async () => {
    const cookie = await login();
    const product = await bySlug("concrete-tray");
    await action("/droplets/product-admin?/delete", { id: product.id }, { cookie });
    const notice = (html: string) => /<p class="gone">This product is no longer available\.[\s\S]*?<\/p>/.exec(html)?.[0];

    // An old link to the build's page: the stored page is never served, only the notice.
    const stored = await call(`/droplets/product-page?slug=concrete-tray&v=${product.v}`);
    const storedHtml = await stored.text();
    expect(storedHtml).not.toContain("Concrete Tray</h1>");
    expect(notice(storedHtml)).toBeDefined();

    // The canonical (shared) URL renders live: the same notice, the same status.
    const canonical = await call("/droplets/product-page?slug=concrete-tray");
    const canonicalHtml = await canonical.text();
    expect(canonical.status).toBe(stored.status);
    expect(canonical.status).toBe(200);
    expect(notice(canonicalHtml)).toBe(notice(storedHtml));
    expect(canonicalHtml).not.toContain("Concrete Tray</h1>");

    // A slug that never was a product is still a 404.
    expect((await call("/droplets/product-page?slug=no-such-product")).status).toBe(404);
  });

  it("refuses action names that are not its own", async () => {
    for (const name of ["__proto__", "constructor", "toString"]) {
      expect((await action(`/droplets/product-admin?/${name}`, {})).status).toBe(404);
    }
  });
});

describe("the product page's version (`v`)", () => {
  const slug = "canvas-urban-tote";
  /** The fragment as a host fetches it for its page at `page`: the page's URL as Referer. */
  const fragment = (props: string, page = `${ORIGIN}/product/${slug}`) =>
    call(`/droplets/product-page?slug=${slug}${props}`, { headers: { accept: "text/html", referer: page } });
  const renderId = async (response: Response) => /data-render-id="(\w+)"/.exec(await response.text())![1];

  it("is on every link the shop builds: cards, the cart, related products", async () => {
    const card = await bySlug(slug);
    expect(card.v).toMatch(/^[0-9a-f]{10}$/);
    const cart = await postJson("/api/cart/items", { productId: card.id, qty: 1 });
    const line = (await cart.json()).cart.items.find((item: { slug: string }) => item.slug === slug);
    expect(line.v).toBe(card.v);
    const html = await (await fragment(`&v=${card.v}`)).text();
    const related = [...html.matchAll(/href="\/product\/([a-z0-9-]+)\?v=([0-9a-f]{10})"/g)];
    expect(related.length).toBeGreaterThan(0);
    for (const [, other, v] of related) expect(v).toBe((await bySlug(other!)).v);
  });

  it("serves the build's page with the current v, and renders live without one", async () => {
    const { v } = await bySlug(slug);
    expect(await renderId(await fragment(`&v=${v}`))).toBe(await renderId(await fragment(`&v=${v}`)));
    expect(await renderId(await fragment(""))).not.toBe(await renderId(await fragment("")));
  });

  it("changes when an admin edit changes the page: the new v renders live, the old one redirects", async () => {
    const before = await bySlug(slug);
    const { data } = await (await call(`/droplets/product-page/_data?slug=${slug}`)).json();
    const cookie = await login();
    const saved = await action(
      "/droplets/product-admin?/update",
      {
        id: before.id,
        name: "Canvas Urban Tote, Renamed",
        slug,
        category: before.category,
        price: (before.priceCents / 100).toFixed(2),
        stock: String(before.stock),
        description: data.product.description,
        details: data.product.details.join(" · "),
      },
      { cookie },
    );
    expect(await saved.json()).toMatchObject({ type: "success", data: { saved: before.id } });

    const after = await bySlug(slug);
    expect(after.v).toMatch(/^[0-9a-f]{10}$/);
    expect(after.v).not.toBe(before.v);

    // The gallery's link now: not prerendered, so live, with the new name.
    const current = await fragment(`&v=${after.v}`, `${ORIGIN}/product/${slug}?v=${after.v}`);
    expect(current.status).toBe(200);
    expect(await current.text()).toContain("<h1>Canvas Urban Tote, Renamed</h1>");

    // An old link: to the same host page without v, its other parameters kept.
    const old = await fragment(`&v=${before.v}`, `${ORIGIN}/product/${slug}?v=${before.v}&order=newest`);
    expect(old.status).toBe(302);
    expect(old.headers.get("location")).toBe(`${ORIGIN}/product/${slug}?order=newest`);

    // The canonical URL: live, the new name.
    expect(await (await fragment("")).text()).toContain("<h1>Canvas Urban Tote, Renamed</h1>");
    // A related page lists the new name, so its version changed too.
    const html = await (await fragment(`&v=${after.v}`)).text();
    const [, other, v] = /href="\/product\/([a-z0-9-]+)\?v=([0-9a-f]{10})"/.exec(html)!;
    const otherPage = await (await call(`/droplets/product-page?slug=${other}&v=${v}`)).text();
    expect(otherPage).toContain(`href="/product/${slug}?v=${after.v}"`);
    expect(otherPage).toContain("Canvas Urban Tote, Renamed");
  });

  it("refuses a v that is not one", async () => {
    expect((await fragment("&v=nope")).status).toBe(400);
    expect((await fragment("&v=0123456789abcdef")).status).toBe(400);
  });
});

describe("comments", () => {
  const id = async () => (await bySlug("clay-cylinder-mug")).id as string;

  it("serves full oldest-first pages from the build, the rest live", async () => {
    const productId = await id();
    const renderIds = async (query: string) => {
      const ids = [];
      for (let i = 0; i < 2; i++) {
        const html = await (await call(`/droplets/product-comments?productId=${productId}${query}`)).text();
        ids.push(/data-render-id="(\w+)"/.exec(html)![1]);
      }
      return ids;
    };
    const stored = await renderIds("");
    expect(stored[0]).toBe(stored[1]);
    const live = await renderIds("&order=newest");
    expect(live[0]).not.toBe(live[1]);
    // 43 comments: page 5 of 10 is partial, so live.
    const partial = await renderIds("&page=5");
    expect(partial[0]).not.toBe(partial[1]);
  });

  it("leaves the total out of the render, and answers it from /api/comments", async () => {
    const productId = await id();
    const html = await (await call(`/droplets/product-comments?productId=${productId}`)).text();
    expect(html).not.toContain("Load more");
    expect(html).not.toMatch(/Comments\s*<small>/);
    const { body } = await getJson(`/api/comments?productId=${productId}&page=5&showing=10`);
    expect(body).toMatchObject({ total: 43, page: 5, pageCount: 5 });
    expect(body.comments).toHaveLength(3);
  });

  it("reads further pages through GET _data, publicly cacheable", async () => {
    const productId = await id();
    const response = await call(`/droplets/product-comments/_data?productId=${productId}&page=2`);
    expect(response.headers.get("cache-control")).toMatch(/^public/);
    expect((await response.json()).data.comments).toHaveLength(10);
  });

  it("posts a comment through an action, checking each field", async () => {
    const productId = await id();
    const bad = await action(`/droplets/product-comments?/post&productId=${productId}`, { author: "A", body: "" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).data.errors).toMatchObject({ author: expect.any(String), body: expect.any(String) });

    const ok = await action(`/droplets/product-comments?/post&productId=${productId}`, { author: "Ana", body: "Lovely mug." });
    expect(await ok.json()).toEqual({ type: "success", status: 200, data: { posted: true } });
    expect((await getJson(`/api/comments?productId=${productId}`)).body.total).toBe(44);
  });

  it("refuses bad props", async () => {
    expect((await call("/api/comments?productId=p_abcdef&showing=7")).status).toBe(400);
    expect((await call("/api/comments")).status).toBe(400);
    expect((await call("/droplets/product-comments?productId=p_abcdef&order=random")).status).toBe(400);
  });
});

describe("without JavaScript (Post/Redirect/Get)", () => {
  /** A browser's form post with JavaScript off: no JSON accept, the page it was on as Referer. */
  const nativePost = (path: string, fields: Record<string, string>, page: string, cookie?: string) =>
    call(path, {
      method: "POST",
      body: new URLSearchParams(fields),
      ...(cookie ? { cookie } : {}),
      headers: { origin: ORIGIN, accept: "text/html,application/xhtml+xml,*/*;q=0.8", referer: page },
    });
  /** The fragment as a host fetches it for its page at `page`: the page's URL as Referer. */
  const fragmentOn = async (path: string, page: string, cookie?: string) =>
    (await call(path, { ...(cookie ? { cookie } : {}), headers: { accept: "text/html", referer: page } })).text();

  it("adds to the cart from the product page, back on the page with the result", async () => {
    const product = (await products()).find((p) => p.stockState === "in" && p.slug !== "clay-cylinder-mug")!;
    const page = `${ORIGIN}/product/${product.slug}?order=newest`;
    const posted = await nativePost(`/droplets/product-page?/add&slug=${product.slug}`, { productId: product.id, qty: "2" }, page);
    expect(posted.status).toBe(303);
    const back = posted.headers.get("location")!;
    expect(back).toMatch(new RegExp(`^${page.replace(/[.?]/g, "\\$&")}&__droplet_form_product-page_\\w+=[\\w-]+\\.[\\w-]{43}$`));
    const cookie = cookieOf(posted, "cart_id")!;
    expect(cookie).toMatch(/^cart_id=/);

    // The host renders the page it was sent back to: the product page, live,
    // with the result on its button (no message under the form: with
    // JavaScript a toast says it).
    const html = await fragmentOn(`/droplets/product-page?slug=${product.slug}`, back, cookie);
    expect(html).toMatch(/<button class="button primary"\s*>✓ Added<\/button>/);
    expect(html).not.toContain('class="notice');
    expect(html).not.toContain("%live:");
    expect((await getJson("/api/cart", { cookie })).body.cart.count).toBe(2);
    // The same page without the result, or with a forged one: as before.
    expect(await fragmentOn(`/droplets/product-page?slug=${product.slug}`, page, cookie)).not.toContain("✓ Added");
    const forged = back.replace(/\.[\w-]{43}$/, `.${"A".repeat(43)}`);
    expect(await fragmentOn(`/droplets/product-page?slug=${product.slug}`, forged, cookie)).not.toContain("✓ Added");
  });

  it("says why a login failed on the login page, and redirects to next when it works", async () => {
    const page = `${ORIGIN}/login?next=/admin`;
    const failed = await nativePost("/droplets/login?/login&next=/admin", { user: "admin", password: "nope" }, page);
    expect(failed.status).toBe(303);
    expect(failed.headers.getSetCookie()).toEqual([]);
    const back = failed.headers.get("location")!;
    expect(back.startsWith(`${page}&__droplet_form_login_`)).toBe(true);
    expect(await fragmentOn("/droplets/login?next=/admin", back)).toContain("Wrong user or password.");
    expect(await fragmentOn("/droplets/login?next=/admin", page)).not.toContain("Wrong user or password.");

    const ok = await nativePost("/droplets/login?/login&next=/admin", { user: "admin", password: "droplets" }, page);
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe(`${ORIGIN}/admin`);
    expect(cookieOf(ok, "shop_admin")).toMatch(/^shop_admin=admin\./);
  });

  it("goes back only to a page on the shop's own or a trusted origin", async () => {
    const product = (await products()).find((p) => p.stockState === "in")!;
    const posted = await nativePost(
      `/droplets/product-page?/add&slug=${product.slug}`,
      { productId: product.id },
      "https://evil.example/x",
    );
    expect(posted.status).toBe(400);
    expect(posted.headers.get("location")).toBeNull();
    expect(posted.headers.getSetCookie()).toEqual([]);
  });
});

describe("/api/images", () => {
  it("serves an image by key, and nothing else", async () => {
    const response = await call("/api/images/clay-cylinder-mug.webp");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    for (const key of ["..%2Fshop.db", "%2e%2e%2fpackage.json", "x.svg", "nope.webp"]) {
      expect((await call(`/api/images/${key}`)).status).toBe(404);
    }
  });
});

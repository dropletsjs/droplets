import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Claims, signAssertion } from "../src/lib/server/host-identity.ts";
import type { CardProduct } from "../src/lib/types.ts";
import { startMockWordPress, type MockWordPress } from "./mock-wordpress.ts";

// wp-shop built and run against a stand-in WordPress (mock-wordpress.ts),
// as the container does at start: `vite build` reads the catalogue and the
// comments from its REST API, prerenders, and the built server answers.
// Driven in-process through its fetch handler; WordPress's origin is the
// host (DROPLETS_TRUSTED_ORIGINS).
const root = fileURLToPath(new URL("..", import.meta.url));
const tmp = fileURLToPath(new URL(".tmp/", import.meta.url));
const SECRET = "test-host-secret-0123456789abcdef-0123456789";
const SERVICE_SECRET = "test-service-secret-0123456789abcdef-01234567";
const HOST = "http://localhost:8008";
const ORIGIN = "http://localhost:8310";

let wp: MockWordPress;
let server: { fetch(request: Request): Promise<Response> };

/** `vite build`, asynchronously: the stand-in WordPress answers it from this process. */
function build(env: NodeJS.ProcessEnv): Promise<void> {
  const vite = `${root}node_modules/vite/bin/vite.js`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vite, "build", "--logLevel", "error"], { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`vite build failed:\n${errors}`))));
  });
}

beforeAll(async () => {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  wp = await startMockWordPress({ serviceSecret: SERVICE_SECRET });
  Object.assign(process.env, {
    WP_INTERNAL_URL: wp.url,
    WP_PUBLIC_URL: wp.url,
    WP_SHOP_HOST_SECRET: SECRET,
    WP_SHOP_SERVICE_SECRET: SERVICE_SECRET,
    WP_SHOP_DATABASE: `${tmp}wp-shop.db`,
    DROPLETS_SECRET: "test-droplets-secret-0123456789abcdef-0123",
    DROPLETS_TRUSTED_ORIGINS: HOST,
  });
  await build(process.env);
  server = (await import(`${root}dist/server.js?${Date.now()}`)).default;
});

afterAll(() => wp?.close());

type Init = RequestInit & { cookie?: string };

const call = (path: string, { cookie, headers, ...init }: Init = {}) =>
  server.fetch(
    new Request(`${ORIGIN}${path}`, {
      ...init,
      headers: { "x-droplet-location": HOST, ...(cookie ? { cookie } : {}), ...(headers as Record<string, string>) },
    }),
  );

/** As the plugin would sign it for this request. */
const assertion = (method: string, path: string, over: Partial<Claims> = {}) =>
  signAssertion(
    { sub: "admin", role: "administrator", exp: Math.floor(Date.now() / 1000) + 60, method, path, aud: "wp-shop", ...over },
    SECRET,
  );

/** A browser's enhanced form post through the plugin's proxy. */
const action = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  call(path, { method: "POST", body: new URLSearchParams(fields), headers: { origin: HOST, accept: "application/json", ...headers } });

const products = async () => ((await (await call("/api/products?limit=48")).json()) as { items: CardProduct[] }).items;
const bySlug = async (slug: string) => (await products()).find((p) => p.slug === slug)!;
const renderId = (html: string) => /data-render-id="(\w+)"/.exec(html)?.[1];

describe("the catalogue, from WordPress", () => {
  it("lists WordPress's products with their Media Library images", async () => {
    const items = await products();
    expect(items).toHaveLength(6);
    const mug = items.find((p) => p.slug === "clay-cylinder-mug")!;
    expect(mug).toMatchObject({ id: "p_10", salePriceCents: 960, salePct: 20, badges: ["sale"] });
    expect(mug.image).toBe(`${wp.url}/wp-content/uploads/2026/11/m-100.webp`);
    expect(mug.v).toMatch(/^[0-9a-f]{10}$/);
  });

  it("serves the product page prerendered at build, its stock filled in from WordPress now", async () => {
    const { v } = await bySlug("linen-notebook");
    const page = async () => (await call(`/droplets/product-page?slug=linen-notebook&v=${v}`)).text();
    const before = await page();
    expect(renderId(before)).toBe(renderId(await page()));
    expect(before).toContain("<h1>Linen Notebook</h1>");
    expect(before).toContain(`<p class="stock stock-in">In stock</p>`);
    expect(before).not.toContain("%live:");

    // Stock changes in WordPress (wp-admin's meta box): the same stored page says so.
    wp.state.products.find((p) => p.slug === "linen-notebook")!.meta.shop_stock = 0;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const after = await page();
    expect(renderId(after)).toBe(renderId(before));
    expect(after).toContain(`<p class="stock stock-out">Out of stock</p>`);
  });

  it("renders a page without v live, and redirects an old v to the page without it", async () => {
    const live = await (await call("/droplets/product-page?slug=brass-pen-holder")).text();
    expect(renderId(live)).not.toBe(renderId(await (await call("/droplets/product-page?slug=brass-pen-holder")).text()));
    const old = await call("/droplets/product-page?slug=brass-pen-holder&v=0123456789", {
      headers: { referer: `${HOST}/product/brass-pen-holder?v=0123456789` },
    });
    expect(old.status).toBe(302);
    expect(old.headers.get("location")).toBe(`${HOST}/product/brass-pen-holder`);
  });

  it("renders an old v live, never a redirect, when the Referer is not a page on WordPress or wp-shop", async () => {
    const stranger = "https://evil.example";
    const strangers: Record<string, string>[] = [
      { referer: `${stranger}/product/brass-pen-holder?v=0123456789` },
      { referer: `${stranger}/p`, origin: stranger },
    ];
    for (const headers of strangers) {
      const response = await call("/droplets/product-page?slug=brass-pen-holder&v=0123456789", {
        headers: { accept: "text/html", ...headers },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(await response.text()).toContain("<h1>Brass Pen Holder</h1>");
    }
  });

  it("prerenders full oldest-first comment pages, the rest live", async () => {
    const ids = async (query: string) => {
      const html = await (await call(`/droplets/product-comments?productId=p_10${query}`)).text();
      return renderId(html);
    };
    expect(await ids("")).toBe(await ids(""));
    expect(await ids("&order=newest")).not.toBe(await ids("&order=newest"));
    const total = await (await call("/api/comments?productId=p_10&page=3&showing=10")).json();
    expect(total).toMatchObject({ total: 23, page: 3, pageCount: 3 });
  });
});

describe("the WordPress admin, through x-wp-shop-user", () => {
  const list = (headers: Record<string, string> = {}) =>
    call("/droplets/product-admin", { headers: { accept: "text/html", referer: `${HOST}/admin`, ...headers } });

  it("without one, links to wp-login.php and back to the page", async () => {
    const gate = await (await list()).text();
    expect(gate).toContain(`href="/wp-login.php?redirect_to=%2Fadmin"`);
    expect(gate).not.toContain("Stock of");
  });

  it("with one, renders the list", async () => {
    const html = await (await list({ "x-wp-shop-user": await assertion("GET", "/droplets/product-admin") })).text();
    expect(html).toMatch(/Logged in to WordPress as <b[^>]*>admin<\/b>/);
    expect(html).toContain(`aria-label="Stock of Clay Cylinder Mug"`);
    const me = await (await call("/api/auth/me", { headers: { "x-wp-shop-user": await assertion("GET", "/api/auth/me") } })).json();
    expect(me).toEqual({ admin: { name: "admin" } });
  });

  it("ignores one for another path, method or audience, an expired one, a forged one", async () => {
    for (const header of [
      await assertion("GET", "/droplets/product-library"),
      await assertion("POST", "/droplets/product-admin"),
      await assertion("GET", "/droplets/product-admin", { aud: "wordpress" }),
      await assertion("GET", "/droplets/product-admin", { exp: Math.floor(Date.now() / 1000) - 1 }),
      `${(await assertion("GET", "/droplets/product-admin")).split(".")[0]}.${"A".repeat(43)}`,
      // Signed with the other direction's secret.
      await signAssertion(
        {
          sub: "admin",
          role: "administrator",
          exp: Math.floor(Date.now() / 1000) + 60,
          method: "GET",
          path: "/droplets/product-admin",
          aud: "wp-shop",
        },
        SERVICE_SECRET,
      ),
    ]) {
      expect(await (await list({ "x-wp-shop-user": header })).text()).toContain("wp-login.php");
    }
  });

  it("saves stock and price to WordPress as that admin, and refuses without one", async () => {
    const path = "/droplets/product-admin?/save";
    const fields = { id: "p_11", stock: "0", price: "18.50" };
    const refused = await action(path, fields);
    expect(refused.status).toBe(401);
    expect((await refused.json()).data.reason).toBe("login");
    // An assertion made for a GET of the same path is no good for the POST.
    expect((await action(path, fields, { "x-wp-shop-user": await assertion("GET", path) })).status).toBe(401);

    const saved = await action(path, fields, { "x-wp-shop-user": await assertion("POST", path) });
    expect(await saved.json()).toMatchObject({ type: "success", data: { saved: "p_11", stock: 0 } });
    expect(wp.writes.at(-1)).toEqual({ user: "admin", post: 11, meta: { shop_stock: 0, shop_price_cents: 1850 } });
    expect(await bySlug("double-wall-tumbler")).toMatchObject({ stock: 0, stockState: "out", priceCents: 1850 });

    const bad = await action(path, { id: "p_11", stock: "-1", price: "x" }, { "x-wp-shop-user": await assertion("POST", path) });
    expect(bad.status).toBe(400);
  });

  it("recognizes no admin, and says why, while both secrets are the same value", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env["WP_SHOP_SERVICE_SECRET"] = SECRET;
    try {
      expect(await (await list({ "x-wp-shop-user": await assertion("GET", "/droplets/product-admin") })).text()).toContain("wp-login.php");
      const path = "/droplets/product-admin?/save";
      expect(
        (await action(path, { id: "p_11", stock: "5", price: "18.50" }, { "x-wp-shop-user": await assertion("POST", path) })).status,
      ).toBe(401);
      expect(errors.mock.calls.flat().join("\n")).toContain("WP_SHOP_HOST_SECRET and WP_SHOP_SERVICE_SECRET are the same value");
    } finally {
      process.env["WP_SHOP_SERVICE_SECRET"] = SERVICE_SECRET;
      errors.mockRestore();
    }
    // Apart again: the admin is back.
    expect(await (await list({ "x-wp-shop-user": await assertion("GET", "/droplets/product-admin") })).text()).toMatch(
      /Logged in to WordPress as/,
    );
  });
});

describe("the demo secrets, in production", () => {
  const list = (headers: Record<string, string> = {}) =>
    call("/droplets/product-admin", { headers: { accept: "text/html", referer: `${HOST}/admin`, ...headers } });

  it("refuses .env.example's values once NODE_ENV is production: no admin, said once", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const demo = "demo-only-host-secret-change-me-0123456789abcdef";
    const was = { NODE_ENV: process.env["NODE_ENV"], WP_SHOP_HOST_SECRET: process.env["WP_SHOP_HOST_SECRET"] };
    Object.assign(process.env, { NODE_ENV: "production", WP_SHOP_HOST_SECRET: demo });
    try {
      const path = "/droplets/product-admin";
      const header = await signAssertion(
        { sub: "admin", role: "administrator", exp: Math.floor(Date.now() / 1000) + 60, method: "GET", path, aud: "wp-shop" },
        demo,
      );
      expect(await (await list({ "x-wp-shop-user": header })).text()).toContain("wp-login.php");
      expect(await (await list({ "x-wp-shop-user": header })).text()).toContain("wp-login.php");
      const said = errors.mock.calls.flat().filter((line) => String(line).includes("WP_SHOP_HOST_SECRET is the demo value"));
      expect(said).toHaveLength(1);
    } finally {
      for (const [name, value] of Object.entries(was)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      errors.mockRestore();
      warnings.mockRestore();
    }
    // Back as it was: the real secret names the admin again.
    expect(await (await list({ "x-wp-shop-user": await assertion("GET", "/droplets/product-admin") })).text()).toContain(
      "Clay Cylinder Mug",
    );
  });
});

describe("the cart, in wp-shop's SQLite", () => {
  it("adds a WordPress product, and refuses a sold-out one", async () => {
    const added = await action("/droplets/product-library?/add", { productId: "p_14" });
    expect((await added.json()).data).toEqual({ added: "p_14", name: "Brass Pen Holder", count: 1 });
    const cookie = added.headers
      .getSetCookie()
      .find((line) => line.startsWith("cart_id="))!
      .split(";")[0]!;
    const { cart } = await (await call("/api/cart", { cookie })).json();
    expect(cart.items).toEqual([
      expect.objectContaining({ productId: "p_14", qty: 1, image: `${wp.url}/wp-content/uploads/2026/11/m-104.webp` }),
    ]);
    const out = await action("/droplets/product-library?/add", { productId: "p_12" });
    expect(out.status).toBe(409);
  });

  it("refuses a form posted from another origin", async () => {
    const response = await call("/droplets/product-library?/add", {
      method: "POST",
      body: new URLSearchParams({ productId: "p_15" }),
      headers: { origin: "http://evil.example" },
    });
    expect(response.status).toBe(403);
  });
});

describe("the JSON API's input", () => {
  it("takes __proto__ as data, never as a prototype", async () => {
    const response = await call("/api/stock/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"__proto__":{"ids":["p_10"],"polluted":1}}`,
    });
    expect(response.status).toBe(400);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("refuses a body over the limit with 413", async () => {
    const response = await call("/api/stock/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"ids":["p_10"],"pad":"${"x".repeat(1024 * 1024)}"}`,
    });
    expect(response.status).toBe(413);
  });

  it("refuses a bad query with 400", async () => {
    for (const path of [
      "/api/products?limit=0",
      "/api/products?limit=49",
      "/api/products?sort=evil",
      "/api/products?cursor=%00",
      "/api/comments?productId=nope",
      "/api/comments?productId=p_10&showing=7",
    ]) {
      expect((await call(path)).status, path).toBe(400);
    }
  });
});

describe("comments, posted to WordPress", () => {
  it("checks each field, then posts", async () => {
    const path = "/droplets/product-comments?/post&productId=p_11";
    expect((await action(path, { author: "A", body: "" })).status).toBe(400);
    const ok = await action(path, { author: "Ana", body: "Lovely tumbler." });
    expect(await ok.json()).toEqual({ type: "success", status: 200, data: { posted: true, held: false } });
    expect(wp.state.comments.at(-1)).toMatchObject({ post: 11, author_name: "Ana" });
  });
});

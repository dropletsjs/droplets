import type { Browser, Page, Request } from "@playwright/test";
import { expect, HOST, test } from "./record.ts";

/**
 * examples/hosts/static: one static HTML page that asks the shop's droplets
 * server for its fragments from the browser, on that server's own origin,
 * with no proxy. The shop as far as a cross-origin page takes it: the
 * gallery, a product page and its comments, a category by its URL. The
 * cart and the admin need the shop's cookies, which a cross-origin request
 * does not carry, so this flow leaves them out and shop.spec.ts is not run
 * here.
 */
test.skip(!HOST.startsWith("static"), "the static host only");

/** The shop's droplets server, as the browser reaches it (run.mjs sets it). */
const DROPLETS = process.env["DROPLETS_URL"] ?? "http://localhost:8000";

function requests(page: Page) {
  const seen: Request[] = [];
  page.on("request", (request) => seen.push(request));
  return { to: (pattern: RegExp) => seen.filter((request) => pattern.test(request.url())) };
}

/** A page in a context of its own, not recorded: the flow's video stays the shop's. */
async function unrecorded(browser: Browser, baseURL: string | undefined, options: { javaScriptEnabled?: boolean } = {}) {
  const context = await browser.newContext({ baseURL, ...options });
  return { context, page: await context.newPage() };
}

test("the shop on a static page, cross-origin", async ({ page, rec, baseURL }) => {
  const sent = requests(page);
  const shop = (id: string) => page.locator(`djs-shop[data-droplet="${id}"]`);
  const library = shop("product-library");
  const cards = library.locator("article.card");

  // 1. The gallery: the filter and the library fetched from the shop's own
  //    origin and inserted, hydrated there; nothing asked of this page's origin.
  await page.goto("/gallery");
  await expect(page.locator("main h1").first()).toHaveText("Everything a demo shop needs.");
  await expect(cards.first()).toBeVisible();
  await expect(library.getByRole("button", { name: "Sort" })).toHaveCount(0);
  await expect(shop("product-filter").locator("form.filter")).toBeVisible();
  await expect(page.locator("djs-shop").first()).toHaveAttribute("data-droplet", "toast-center");
  await expect(page.getByRole("navigation", { name: "Shop" }).getByRole("link", { name: "Gallery" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const [fragment] = sent.to(/\/droplets\/product-library\?/);
  expect(fragment, "the library's fragment request").toBeDefined();
  expect(fragment!.url().startsWith(`${DROPLETS}/`)).toBe(true);
  expect(sent.to(new RegExp(`^${baseURL}/(?:droplets|index\\.js|assets|api)`))).toHaveLength(0);
  expect(sent.to(/\/index\.js$/)).toHaveLength(1);
  await rec.beat();
  await rec.shot("1-gallery");

  // 2. A card's link: this page again, at /product/<slug>?v=…, now asking
  //    for the product page and its comments.
  const link = cards.first().locator("h3.name a");
  const name = (await link.textContent())!.trim();
  await rec.click(link);
  await expect(page).toHaveURL(/\/product\/[a-z0-9-]+\?v=[0-9a-f]{10}$/);
  await expect(shop("product-page").locator("h1")).toHaveText(name);
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs).toContainText(name);
  await expect(page).toHaveTitle(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · `));
  await rec.beat();
  await rec.shot("2-product");

  // 3. Its comments, asked for with the product's id from the page's `_data`.
  const comments = shop("product-comments");
  await rec.reveal(comments);
  await expect(comments.locator("li").first()).toBeVisible();
  const [request] = sent.to(/\/droplets\/product-comments\?/);
  expect(new URL(request!.url()).searchParams.get("productId")).toMatch(/^p_[a-z0-9]+$/);
  await rec.beat();
  await rec.shot("3-comments");

  // 4. The breadcrumb's category: the gallery again, its query passed to
  //    both droplets, the library narrowed to that category.
  const category = crumbs.getByRole("link").nth(1);
  const slug = new URL((await category.getAttribute("href"))!, baseURL).searchParams.get("category");
  await rec.click(category);
  await expect(page).toHaveURL(new RegExp(`/gallery\\?category=${slug}$`));
  await expect(cards.first()).toBeVisible();
  await expect(shop("product-filter").locator(`input[name="category"][value="${slug}"]`)).toBeChecked();
  const [narrowed] = sent.to(/\/droplets\/product-library\?category=/);
  expect(new URL(narrowed!.url()).searchParams.get("category")).toBe(slug);
  await rec.beat();
  await rec.shot("4-category");
});

// No `page`: a page is recorded, and its video would take the flow's place.
test("a page loaded directly takes its props from its URL", async ({ browser, baseURL }) => {
  const { context, page } = await unrecorded(browser, baseURL);
  const sent = requests(page);

  await page.goto("/gallery?category=mugs");
  await expect(page.locator('djs-shop[data-droplet="product-library"] article.card').first()).toBeVisible();
  const [list] = sent.to(/\/droplets\/product-library\?/);
  expect(new URL(list!.url()).searchParams.get("category")).toBe("mugs");
  await expect(page.locator('djs-shop[data-droplet="product-filter"] input[name="category"][value="mugs"]')).toBeChecked();

  await page.goto("/product/clay-cylinder-mug");
  await expect(page.locator('djs-shop[data-droplet="product-page"] h1')).toHaveText("Clay Cylinder Mug");
  await expect(page.locator('#comments > djs-shop[data-droplet="product-comments"]')).toHaveCount(1);

  await page.goto("/product/no-such-product");
  await expect(page.locator("main h1")).toHaveText("Not found");
  expect((await page.request.get("/product/Not-A-Slug")).status()).toBe(404);
  await context.close();
});

/**
 * An old `v` answers a redirect, opaque to a cross-origin fetch: the page
 * drops `v` from its URL and asks again, and the product renders live.
 */
// No `page`: a page is recorded, and its video would take the flow's place.
test("an old version in the URL renders the product live", async ({ browser, baseURL }) => {
  const { context, page } = await unrecorded(browser, baseURL);
  await page.goto("/product/clay-cylinder-mug?v=0000000000&order=newest");
  await expect(page.locator('djs-shop[data-droplet="product-page"] h1')).toHaveText("Clay Cylinder Mug");
  await expect(page).toHaveURL(/\/product\/clay-cylinder-mug\?order=newest$/);
  await context.close();
});

/** The droplets server answers the page's origin: CORS on, no cookie asked for or sent. */
test("the shop answers this page's origin, without cookies", async ({ request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const answer = await request.get(`${DROPLETS}/droplets/product-filter`, { headers: { origin, accept: "text/html" } });
  expect(answer.status()).toBe(200);
  expect(answer.headers()["access-control-allow-origin"]).toBe("*");
  expect(answer.headers()["access-control-allow-credentials"]).toBeUndefined();
});

/** Without JavaScript the page keeps its header, footer and a note. */
// No `page`: a page is recorded, and its video would take the flow's place.
test("the page without JavaScript", async ({ browser, baseURL }) => {
  const { context, page } = await unrecorded(browser, baseURL, { javaScriptEnabled: false });
  await page.goto("/gallery");
  await expect(page.locator("main > noscript > p")).toHaveText(/needs JavaScript/);
  await expect(page.locator("footer .shop-stack")).toHaveText("Static HTML");
  await expect(page.locator("djs-shop[data-droplet='product-library']")).toHaveCount(0);
  await context.close();
});

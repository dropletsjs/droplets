import type { Browser, Page, Request } from "@playwright/test";
import { expect, HOST, test } from "./record.ts";

/**
 * examples/hosts/static: one static HTML page that asks the shop's droplets
 * server for its fragments from the browser, on that server's own origin,
 * with no proxy. The shop flow itself is shop.spec.ts, as on every shop
 * host; these are what only this page does: its props from its URL, an old
 * version, the shop's CORS answer and the page without JavaScript.
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

/**
 * The droplets server answers this page's origin by name, with credentials,
 * so the cart and the session go along; another origin gets no CORS answer.
 */
test("the shop answers this page's origin with credentials, and no other", async ({ request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const answer = await request.get(`${DROPLETS}/droplets/product-filter`, { headers: { origin, accept: "text/html" } });
  expect(answer.status()).toBe(200);
  expect(answer.headers()["access-control-allow-origin"]).toBe(origin);
  expect(answer.headers()["access-control-allow-credentials"]).toBe("true");
  const other = await request.get(`${DROPLETS}/droplets/product-filter`, {
    headers: { origin: "https://elsewhere.example", accept: "text/html" },
  });
  expect(other.headers()["access-control-allow-origin"]).toBeUndefined();
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

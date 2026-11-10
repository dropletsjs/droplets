import type { Page, Request } from "@playwright/test";
import { expect, HOST, test } from "./record.ts";

/**
 * examples/hosts/htmx: static pages whose droplets htmx swaps in. `/` asks
 * the Svelte example's droplets server for its fragments cross-origin (on
 * load, on a click, once revealed); `/shop` asks the shop, behind the
 * site's proxy, and has its forms: one the droplet enhances, one plain
 * (Post/Redirect/Get), in a body with `hx-boost`. Only on that host: it
 * serves no shop pages of its own, so shop.spec.ts is not run there.
 */
test.skip(!HOST.startsWith("htmx"), "the htmx host only");

/** The Svelte example's droplets server, as the browser reaches it (run.mjs sets it). */
const DROPLETS = process.env["DROPLETS_URL"] ?? "http://localhost:8000";

/** A value the page keeps until it loads again: gone means a full navigation. */
const mark = (page: Page) => page.evaluate(() => ((window as { __kept?: boolean }).__kept = true));
const kept = (page: Page) => page.evaluate(() => (window as { __kept?: boolean }).__kept === true);

/** Every request the page makes from here, to check what went out and what did not. */
function requests(page: Page) {
  const seen: Request[] = [];
  page.on("request", (request) => seen.push(request));
  return {
    to: (pattern: RegExp) => seen.filter((request) => pattern.test(request.url())),
  };
}

test("droplets swapped in by htmx", async ({ page, rec }) => {
  const sent = requests(page);
  const svelte = (mode: string) => page.locator(`djs-svelte[data-droplet="${mode}"]`);
  const card = (mode: string) => svelte(mode).locator(`article[data-mode="${mode}"]`);

  // 1. On load: htmx gets the fragment from the other origin and swaps it
  //    in; the element /index.js defined upgrades, links its stylesheet and
  //    hydrates.
  await page.goto("/");
  await expect(card("ssr-hydrate").getByTestId("hydrated")).toHaveText("yes");
  await expect(card("ssr-hydrate").getByTestId("rendered")).toContainText("on the server");
  await expect(card("ssr-hydrate")).toContainText("Hello htmx!");
  await expect(page.locator("#on-load > djs-svelte")).toHaveCount(1);
  const [fragment] = sent.to(/\/droplets\/ssr-hydrate\?who=htmx$/);
  expect(fragment, "the fragment request").toBeDefined();
  expect(fragment!.url().startsWith(`${DROPLETS}/`)).toBe(true);
  expect(fragment!.headers()["hx-request"]).toBe("true");
  const style = await svelte("ssr-hydrate").evaluate((element) => {
    const link = element.querySelector<HTMLLinkElement>(":scope > link[data-droplet-style]");
    return { href: link?.href ?? "", loaded: Boolean(link?.sheet), radius: getComputedStyle(element.querySelector("article")!).borderTopLeftRadius };
  });
  expect(style.href.startsWith(`${DROPLETS}/droplets/ssr-hydrate/style.css`)).toBe(true);
  expect(style.loaded).toBe(true);
  expect(style.radius).not.toBe("0px");
  const count = card("ssr-hydrate").getByTestId("count");
  await expect(count).toHaveText(/^\d+$/);
  const before = Number(await count.textContent());
  await rec.click(card("ssr-hydrate").getByTestId("bump"));
  await expect(count).toHaveText(String(before + 1));

  // 2. On a click: the client droplet, rendered in the browser.
  await rec.click(page.getByRole("button", { name: "Load the client droplet" }));
  await expect(card("client").getByTestId("hydrated")).toHaveText("yes");
  await expect(card("client").getByTestId("rendered")).toHaveText("in the browser");
  await expect(card("client").getByTestId("time")).not.toHaveText("…");
  await rec.beat();
  await rec.shot("1-swapped");

  // 3. Once revealed: nothing asked for before it scrolls into view; then a
  //    server-rendered droplet that never hydrates (no bundle).
  expect(sent.to(/\/droplets\/ssr-nohydrate/)).toHaveLength(0);
  await rec.reveal(page.locator("#on-reveal"));
  await expect(card("ssr-nohydrate")).toContainText("Hello htmx!");
  await expect(card("ssr-nohydrate").getByTestId("hydrated")).toHaveText("no");
  expect(sent.to(/\/droplets\/ssr-nohydrate\/client\.js/)).toHaveLength(0);
  await rec.beat();

  // 4. A boosted link: htmx swaps the body; the shop's droplets come in
  //    with it, and /index.js, in the shared <head>, is already there.
  await mark(page);
  await page.evaluate(() => scrollTo(0, 0));
  await rec.click(page.getByRole("link", { name: "shop's droplets" }));
  await expect(page).toHaveURL(/\/shop$/);
  const shop = (id: string) => page.locator(`djs-shop[data-droplet="${id}"]`);
  const product = shop("product-page");
  const badge = shop("shopping-cart").locator(".cart-badge");
  await expect(product.locator("h1")).toHaveText("Clay Cylinder Mug");
  await expect(badge).toBeVisible();
  expect(await kept(page), "a boosted link, no page load").toBe(true);
  const items = async () => ((await badge.locator(".cart-count").count()) ? Number(await badge.locator(".cart-count").textContent()) : 0);
  const inCart = await items();

  // 5. The enhanced form, in a container with hx-boost="false": the droplet
  //    posts it by fetch, as JSON, and renders again in place. htmx stays out.
  const posts = sent.to(/\/droplets\/product-page\?\/add/).length;
  await rec.click(product.getByRole("button", { name: "Add to cart" }));
  await expect(product.getByRole("button", { name: "✓ Added" })).toBeVisible();
  await expect(badge.locator(".cart-count")).toHaveText(String(inCart + 1));
  const adds = sent.to(/\/droplets\/product-page\?\/add/).slice(posts);
  expect(adds).toHaveLength(1);
  expect(adds[0]!.headers()["accept"]).toContain("application/json");
  expect(adds[0]!.headers()["hx-request"]).toBeUndefined();
  expect(await kept(page), "posted in place").toBe(true);
  await expect(page).toHaveURL(/\/shop$/);
  await rec.beat();
  await rec.shot("2-added");

  // 6. The plain form: a native post, 303 back to /shop with the signed
  //    result in the query; the login fragment htmx asks for on load gets
  //    the page as Referer, so it renders with the result.
  const login = shop("login");
  await rec.fill(login.locator('input[name="user"]'), "admin");
  await rec.fill(login.locator('input[name="password"]'), "not the password");
  await rec.click(login.getByRole("button", { name: "Log in" }));
  await expect(page).toHaveURL(/\/shop\?__droplet_form_login_[^=&]+=/);
  await expect(login).toContainText("Wrong user or password.");
  expect(await kept(page), "a full page load").toBe(false);
  await rec.beat();
  await rec.shot("3-login");

  // 7. A card asked for once revealed; it hydrates when visible, its own
  //    setting, and its form is enhanced too.
  expect(sent.to(/\/droplets\/product-card/)).toHaveLength(0);
  const lazy = shop("product-card");
  await rec.reveal(page.locator("#card"));
  await expect(lazy.locator("article.card")).toBeVisible();
  await expect.poll(() => sent.to(/\/droplets\/product-card\/client\.js/).length).toBe(1);
  const now = await items();
  await rec.click(lazy.getByRole("button", { name: "Add to cart" }));
  await expect(lazy.getByRole("button", { name: "✓ Added" })).toBeVisible();
  await expect(badge.locator(".cart-count")).toHaveText(String(now + 1));
  await rec.beat();
  await rec.shot("4-lazy");

  // 8. A boosted link back to /, then the browser's Back: htmx restores
  //    /shop from its history and asks for the fragments again; they render
  //    and hydrate as they did the first time, once each.
  await mark(page);
  await page.evaluate(() => scrollTo(0, 0));
  await rec.click(page.getByRole("link", { name: "The Svelte droplets" }));
  await expect(page).toHaveURL(/\/$/);
  await expect(card("ssr-hydrate").getByTestId("hydrated")).toHaveText("yes");
  await page.goBack();
  await expect(page).toHaveURL(/\/shop\?__droplet_form_login_/);
  await expect(product.locator("h1")).toHaveText("Clay Cylinder Mug");
  await expect(page.locator("#product djs-shop")).toHaveCount(1);
  await expect(badge.locator(".cart-count")).toHaveText(String(now + 1));
  expect(await kept(page), "restored by htmx, no page load").toBe(true);
  await rec.beat();
});

/**
 * Cross-origin: htmx sends its own headers (`HX-Request`, `HX-Current-URL`,
 * …), so the browser asks first. `cors: true` on the Svelte example lets
 * any origin and echoes the headers asked for.
 */
// No `page`: a page is recorded, and its video would take the flow's place.
test("the droplets server answers htmx's preflight", async ({ request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const answer = await request.fetch(`${DROPLETS}/droplets/ssr-hydrate?who=htmx`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "GET",
      "access-control-request-headers": "hx-current-url,hx-request,hx-target,hx-trigger",
    },
  });
  expect(answer.status()).toBe(204);
  expect(answer.headers()["access-control-allow-origin"]).toBe("*");
  expect(answer.headers()["access-control-allow-headers"]).toBe("hx-current-url,hx-request,hx-target,hx-trigger");
});

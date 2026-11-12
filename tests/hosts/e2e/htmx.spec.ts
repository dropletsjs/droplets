import type { Browser, Locator, Page, Request } from "@playwright/test";
import { expect, HOST, test } from "./record.ts";

/**
 * examples/hosts/htmx: static pages whose droplets htmx swaps in. The shop
 * (/gallery, /product/<slug>, /login, /admin) asks the shop's droplets
 * server behind the site's proxy and moves between its pages as one app:
 * htmx swaps <main> alone, so the header and the cart badge stay. `/` asks
 * the Svelte example's droplets server for its fragments cross-origin (on
 * load, on a click, once revealed). Only on that host: its pages are its
 * own, so shop.spec.ts is not run there.
 */
test.skip(!HOST.startsWith("htmx"), "the htmx host only");

/** The Svelte example's droplets server, as the browser reaches it (run.mjs sets it). */
const DROPLETS = process.env["DROPLETS_URL"] ?? "http://localhost:8000";

/** A value the page keeps until it loads again: gone means a full navigation. */
const mark = (page: Page) => page.evaluate(() => ((window as { __kept?: boolean }).__kept = true));
const kept = (page: Page) => page.evaluate(() => (window as { __kept?: boolean }).__kept === true);

/** Marks the header element itself: still marked means htmx left it in place. */
const markHeader = (page: Page) =>
  page.locator(".shop-header").evaluate((header) => ((header as HTMLElement & { __kept?: boolean }).__kept = true));
const headerKept = (page: Page) =>
  page.locator(".shop-header").evaluate((header) => (header as HTMLElement & { __kept?: boolean }).__kept === true);

/** Every request the page makes from here, to check what went out and what did not. */
/** Scrolls, smoothly, until `target` ends `gap` px above the viewport's bottom: the footer below it out of the frame. */
const endAbove = (target: Locator, gap = 40) =>
  target.evaluate(
    (element, gap) =>
      new Promise<void>((resolve) => {
        scrollTo({ top: Math.max(0, scrollY + element.getBoundingClientRect().bottom - innerHeight + gap), behavior: "smooth" });
        let last = -1;
        let still = 0;
        const tick = () => {
          if (Math.abs(scrollY - last) >= 0.5) {
            still = 0;
            last = scrollY;
          } else if (++still > 6) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        setTimeout(resolve, 2500);
      }),
    gap,
  );

function requests(page: Page) {
  const seen: Request[] = [];
  page.on("request", (request) => seen.push(request));
  return {
    to: (pattern: RegExp) => seen.filter((request) => pattern.test(request.url())),
  };
}

/** A page in a context of its own, not recorded: the flow's video stays the shop's. */
async function unrecorded(browser: Browser, baseURL: string | undefined, options: { javaScriptEnabled?: boolean } = {}) {
  const context = await browser.newContext({ baseURL, ...options });
  return { context, page: await context.newPage() };
}

test("the shop, one page swapped by htmx", async ({ page, rec }) => {
  const sent = requests(page);
  const shop = (id: string) => page.locator(`djs-shop[data-droplet="${id}"]`);
  const nav = page.getByRole("navigation", { name: "Shop" });
  const badge = shop("shopping-cart").locator(".cart-badge");
  const items = async () => ((await badge.locator(".cart-count").count()) ? Number(await badge.locator(".cart-count").textContent()) : 0);

  // 1. The gallery: the filter and the library swapped in on load, the
  //    cart badge the page wrote, /index.js once.
  await page.goto("/gallery");
  const library = shop("product-library");
  const buyable = library.locator("article.card").filter({ has: page.getByRole("button", { name: "Add to cart" }) });
  await expect(buyable.first()).toBeVisible();
  await expect(shop("product-filter").locator("form.filter")).toBeVisible();
  await expect(badge).toBeVisible();
  await expect(nav.getByRole("link", { name: "Gallery" })).toHaveAttribute("aria-current", "page");
  await rec.beat();
  await rec.shot("1-gallery");
  await mark(page);
  await markHeader(page);

  // 2. A product card's link, rendered by the droplet: htmx fetches the
  //    product page and swaps its <main> in; the URL is pushed, the header
  //    and the badge stay, and the product droplet arrives in the new <main>.
  const link = buyable.first().locator("h3.name a");
  const name = (await link.textContent())!.trim();
  await rec.click(link);
  await expect(page).toHaveURL(/\/product\/[a-z0-9-]+\?v=[0-9a-f]{10}$/);
  const product = shop("product-page");
  await expect(product.locator("h1")).toHaveText(name);
  await expect(page).toHaveTitle(/^Product · /);
  expect(await kept(page), "no page load").toBe(true);
  expect(await headerKept(page), "the same header").toBe(true);
  await expect(nav.getByRole("link", { name: "Gallery" })).not.toHaveAttribute("aria-current");

  // 3. The enhanced form: the droplet posts it by fetch (a form body, a
  //    JSON answer) and renders again in place; htmx stays out.
  const inCart = await items();
  const posts = sent.to(/\/droplets\/product-page\?\/add/).length;
  await rec.click(product.getByRole("button", { name: "Add to cart" }));
  await expect(product.getByRole("button", { name: "✓ Added" })).toBeVisible();
  await expect(badge.locator(".cart-count")).toHaveText(String(inCart + 1));
  const adds = sent.to(/\/droplets\/product-page\?\/add/).slice(posts);
  expect(adds).toHaveLength(1);
  expect(adds[0]!.headers()["accept"]).toContain("application/json");
  expect(adds[0]!.headers()["hx-request"]).toBeUndefined();
  expect(await kept(page), "posted in place").toBe(true);
  await rec.beat();
  await rec.shot("2-added");

  // The comments, asked for once the product is in, with its id.
  const [comments] = sent.to(/\/droplets\/product-comments\?/);
  expect(comments, "the comments' request").toBeDefined();
  expect(new URL(comments!.url()).searchParams.get("productId")).toMatch(/^p_[a-z0-9]+$/);
  await expect(page.locator("#comments > djs-shop")).toHaveCount(1);

  // 4. The header's Admin link (hx-boost), then the admin's own link to the
  //    login, in <main>: both swapped in, no page load.
  await rec.click(nav.getByRole("link", { name: "Admin" }));
  await expect(page).toHaveURL(/\/admin$/);
  await expect(nav.getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "page");
  await rec.click(shop("product-admin").getByRole("link", { name: "Log in" }));
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)admin$/);
  const login = shop("login");
  await expect(login.locator('input[name="user"]')).toBeVisible();
  expect(await kept(page), "still no page load").toBe(true);
  expect(await headerKept(page), "still the same header").toBe(true);
  expect(sent.to(/\/index\.js$/), "/index.js once").toHaveLength(1);

  // 5. The plain form: a native post, 303 back to the page with the signed
  //    result in the query; the login fragment htmx asks for on load gets
  //    the page as Referer, so it renders with the result.
  await rec.fill(login.locator('input[name="user"]'), "admin");
  await rec.fill(login.locator('input[name="password"]'), "not the password");
  await rec.click(login.getByRole("button", { name: "Log in" }));
  await expect(page).toHaveURL(/\/login\?next=[^&]+&__droplet_form_login_[^=&]+=/);
  await expect(login).toContainText("Wrong user or password.");
  expect(await kept(page), "a full page load").toBe(false);
  await rec.beat();
  await rec.shot("3-login");

  // The right password: 303 to `next`, the admin with its session.
  await rec.fill(login.locator('input[name="user"]'), "admin");
  await rec.fill(login.locator('input[name="password"]'), "droplets");
  await rec.click(login.getByRole("button", { name: "Log in" }));
  await expect(page).toHaveURL(/\/admin$/);
  const admin = shop("product-admin");
  await expect(admin.getByRole("link", { name: "Edit" }).first()).toBeVisible();
  await rec.beat();

  // 6. Back to the gallery by the header; a card asked for once revealed,
  //    hydrated when visible, its form enhanced too.
  await mark(page);
  await markHeader(page);
  await rec.click(nav.getByRole("link", { name: "Gallery" }));
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(buyable.first()).toBeVisible();
  expect(sent.to(/\/droplets\/product-card/)).toHaveLength(0);
  const lazy = shop("product-card");
  const featured = page.locator(".shop-featured");
  await rec.reveal(featured);
  await expect(lazy.locator("article.card")).toBeVisible();
  await endAbove(lazy.locator("article.card"));
  await expect.poll(() => sent.to(/\/droplets\/product-card\/client\.js/).length).toBe(1);
  const now = await items();
  await rec.click(lazy.getByRole("button", { name: "Add to cart" }));
  await expect(lazy.getByRole("button", { name: "✓ Added" })).toBeVisible();
  await expect(badge.locator(".cart-count")).toHaveText(String(now + 1));
  await rec.beat();
  await rec.shot("4-lazy");

  // 7. The browser's Back: htmx puts the admin's <main> back from its
  //    history and asks for its droplet again; Forward, the gallery. The
  //    header never moves.
  await page.goBack();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(admin.getByRole("link", { name: "Edit" }).first()).toBeVisible();
  await expect(page.locator("#admin > djs-shop")).toHaveCount(1);
  await expect(nav.getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(buyable.first()).toBeVisible();
  await expect(badge.locator(".cart-count")).toHaveText(String(now + 1));
  expect(await kept(page), "restored by htmx, no page load").toBe(true);
  expect(await headerKept(page), "the same header throughout").toBe(true);
  await rec.beat();
  await rec.reveal(page.locator(".shop-hero"));
  await rec.beat();
});

/**
 * Each shop page is a whole file: loaded directly, it asks for its droplets
 * with the props its URL holds (shop.js), and a droplet that answers an
 * error leaves a note.
 */
// No `page`: a page is recorded, and its video would take the flow's place.
test("a shop page loaded directly", async ({ browser, baseURL }) => {
  const { context, page } = await unrecorded(browser, baseURL);
  const sent = requests(page);

  await page.goto("/gallery?category=mugs&ignored=1");
  const library = page.locator('djs-shop[data-droplet="product-library"]');
  await expect(library.locator("article.card").first()).toBeVisible();
  const [list] = sent.to(/\/droplets\/product-library\?/);
  expect(new URL(list!.url()).search).toBe("?category=mugs");
  await expect(page.locator('djs-shop[data-droplet="product-filter"] input[name="category"][value="mugs"]')).toBeChecked();

  await page.goto("/product/clay-cylinder-mug");
  await expect(page.locator('djs-shop[data-droplet="product-page"] h1')).toHaveText("Clay Cylinder Mug");
  await expect(page.locator("#comments > djs-shop")).toHaveCount(1);
  const [fragment] = sent.to(/\/droplets\/product-page\?/);
  expect(new URL(fragment!.url()).search).toBe("?slug=clay-cylinder-mug");

  await page.goto("/product/no-such-product");
  await expect(page.locator("#product")).toHaveText("This droplet is unavailable.");
  await expect(page.locator("#comments")).toBeEmpty();
  expect((await page.request.get("/product/Not-A-Slug")).status()).toBe(404);
  await context.close();
});

/** Without JavaScript a shop page is still the whole page, header and links, with a note. */
// No `page`: a page is recorded, and its video would take the flow's place.
test("a shop page without JavaScript", async ({ browser, baseURL }) => {
  const { context, page } = await unrecorded(browser, baseURL, { javaScriptEnabled: false });
  await page.goto("/gallery");
  await expect(page.getByRole("navigation", { name: "Shop" }).getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
  await expect(page.locator("main > noscript > p")).toBeVisible();
  await expect(page.locator("main > noscript > p")).toHaveText(/which needs JavaScript/);
  await page.getByRole("navigation", { name: "Shop" }).getByRole("link", { name: "Admin" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page).toHaveTitle(/^Admin · /);
  await context.close();
});

// No `page`: a page is recorded, and its video would take the flow's place.
test("the Svelte example's droplets, swapped in cross-origin", async ({ browser, baseURL }) => {
  const { context, page } = await unrecorded(browser, baseURL);
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
    return {
      href: link?.href ?? "",
      loaded: Boolean(link?.sheet),
      radius: getComputedStyle(element.querySelector("article")!).borderTopLeftRadius,
    };
  });
  expect(style.href.startsWith(`${DROPLETS}/droplets/ssr-hydrate/style.css`)).toBe(true);
  expect(style.loaded).toBe(true);
  expect(style.radius).not.toBe("0px");
  const count = card("ssr-hydrate").getByTestId("count");
  await expect(count).toHaveText(/^\d+$/);
  const before = Number(await count.textContent());
  await card("ssr-hydrate").getByTestId("bump").click();
  await expect(count).toHaveText(String(before + 1));

  // 2. On a click: the client droplet, rendered in the browser.
  await page.getByRole("button", { name: "Load the client droplet" }).click();
  await expect(card("client").getByTestId("hydrated")).toHaveText("yes");
  await expect(card("client").getByTestId("rendered")).toHaveText("in the browser");
  await expect(card("client").getByTestId("time")).not.toHaveText("…");

  // 3. Once revealed: nothing asked for before it scrolls into view; then a
  //    server-rendered droplet that never hydrates (no bundle).
  expect(sent.to(/\/droplets\/ssr-nohydrate/)).toHaveLength(0);
  await page.locator("#on-reveal").scrollIntoViewIfNeeded();
  await expect(card("ssr-nohydrate")).toContainText("Hello htmx!");
  await expect(card("ssr-nohydrate").getByTestId("hydrated")).toHaveText("no");
  expect(sent.to(/\/droplets\/ssr-nohydrate\/client\.js/)).toHaveLength(0);

  // 4. The link to the shop: a page of its own, loaded in full.
  await mark(page);
  await page.getByRole("link", { name: "shop" }).click();
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(page.locator('djs-shop[data-droplet="product-library"] article.card').first()).toBeVisible();
  expect(await kept(page)).toBe(false);
  await context.close();
});

/**
 * The page of the Svelte droplets turns htmx's `selfRequestsOnly` off (its
 * check runs before `htmx:validateUrl`), and `droplet-origins.js` allows
 * only the origins the page loads an /index.js from: any other origin is
 * refused as htmx's own `htmx:invalidPath`, and no request goes out.
 */
// No `page`: a page is recorded, and its video would take the flow's place.
test("htmx reaches the droplets server's origin and no other", async ({ browser, baseURL }) => {
  const { context, page } = await unrecorded(browser, baseURL);
  const sent = requests(page);
  await page.goto("/");
  await expect(page.locator('djs-svelte[data-droplet="ssr-hydrate"] article')).toBeVisible();

  const refused = await page.evaluate(async () => {
    const probe = document.createElement("div");
    probe.setAttribute("hx-get", "http://localhost:1/droplets/client");
    probe.setAttribute("hx-trigger", "load");
    const outcome = new Promise<string>((resolve) => {
      probe.addEventListener("htmx:invalidPath", () => resolve("invalidPath"));
      probe.addEventListener("htmx:beforeRequest", () => resolve("requested"));
      setTimeout(() => resolve("nothing"), 2000);
    });
    document.body.append(probe);
    (window as unknown as { htmx: { process(element: Element): void } }).htmx.process(probe);
    return outcome;
  });
  expect(refused).toBe("invalidPath");
  expect(sent.to(/^http:\/\/localhost:1\//)).toHaveLength(0);
  await context.close();
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

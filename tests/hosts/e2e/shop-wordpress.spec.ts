import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import { expect, HOST, test } from "./record.ts";
import { COMMENT, postComment } from "./comment.ts";
import { ADMIN, loginCookie, SHOP_SCREEN, wpLogIn } from "./wordpress.ts";

/**
 * The WordPress showcase only. Its admin (the `product-admin` droplet:
 * stock and prices) is the Shop screen in wp-admin
 * (plugin/droplets-embed/shop-admin.php), never a public page; the public
 * droplets are never in wp-admin. This file runs before shop.spec.ts, so
 * the flow, which is the recording, sees the shop as seeded.
 */
test.skip(!HOST.startsWith("wordpress"), "WordPress only");

/** `text` as a regular expression matches it, literally. */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A gallery link to a product page: its slug, and the page's version. */
const PRODUCT_LINK = /^\/product\/([a-z0-9-]+)\?v=([0-9a-f]{10})$/;

const AT_SHOP_SCREEN = new RegExp(`${literal(SHOP_SCREEN)}$`);
const ADMIN_DROPLET = 'djs-shop[data-droplet="product-admin"]';

/**
 * The flow, as a visitor and then the site's administrator: the gallery, a
 * product page read down to its comments and a comment posted there,
 * back to the gallery, a few
 * products into the cart (each with its toast), the cart; then a login to
 * WordPress, wp-admin's Shop screen, the chosen product's stock set to 0,
 * and a logout. As an anonymous visitor again, the gallery, that product's
 * page, and the cart: its availability check says "Out of stock", and so
 * does the page.
 */
test("the shop flow, with the admin in wp-admin", async ({ page, rec, baseURL }) => {
  const secure = new URL(baseURL!).protocol === "https:";
  const droplet = (id: string) => page.locator(`djs-shop[data-droplet="${id}"]`);
  const library = droplet("product-library");
  const product = droplet("product-page");
  const cartDroplet = droplet("shopping-cart");
  const badge = cartDroplet.locator(".cart-badge");
  const drawer = cartDroplet.getByRole("dialog", { name: "Your cart" });
  const toasts = droplet("toast-center");
  const nav = page.locator("header nav");

  // 1. The gallery, rendered on the server, then hydrated.
  await page.goto("/gallery");
  await expect(page.locator("main h1").first()).toHaveText("Everything a demo shop needs.");
  await expect(library.locator("article.card").first()).toBeVisible();
  await expect(library.getByRole("button", { name: "Sort" })).toHaveCount(0);
  await expect(badge).toBeVisible();
  await expect(page.locator("djs-shop").first()).toHaveAttribute("data-droplet", "toast-center");
  // No Admin in the menu: the admin is in wp-admin.
  await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);
  const count = async () => ((await badge.locator(".cart-count").count()) ? Number(await badge.locator(".cart-count").textContent()) : 0);
  const before = await count();
  await rec.beat();
  await rec.shot("1-gallery");

  const buyable = library.locator("article.card").filter({ has: page.getByRole("button", { name: "Add to cart" }) });
  const offered: { name: string; href: string }[] = [];
  for (const card of (await buyable.all()).slice(0, 8)) {
    const link = card.locator("h3.name a");
    offered.push({ name: (await link.textContent())!.trim(), href: (await link.getAttribute("href"))! });
  }
  expect(offered.length).toBeGreaterThanOrEqual(4);
  for (const { href } of offered) expect(href).toMatch(PRODUCT_LINK);
  // The one whose stock goes to 0: a glass or a cup if there is one.
  const chosen = offered.find(({ name }) => /glass|cup|tumbler|mug/i.test(name)) ?? offered[0]!;
  const [read, second, third] = offered.filter((one) => one !== chosen);
  const cardOf = ({ href }: { href: string }) => library.locator("article.card", { has: page.locator(`h3.name a[href="${href}"]`) });
  const add = async (one: { name: string; href: string }, total: number) => {
    const card = cardOf(one);
    await rec.click(card.getByRole("button", { name: "Add to cart" }));
    await expect(card.getByRole("button", { name: "✓ Added" })).toBeVisible();
    await expect(badge.locator(".cart-count")).toHaveText(String(total));
    await expect(toasts.getByRole("status").filter({ hasText: `${one.name} added to your cart` })).toBeVisible();
  };

  // 2. A product page, read down to its comments.
  await rec.click(cardOf(read!).locator("h3.name a"));
  await expect(page).toHaveURL(new RegExp(`${literal(read!.href)}$`));
  await expect(product.locator("h1")).toHaveText(read!.name);
  await expect(droplet("product-comments")).toBeAttached();
  await rec.reveal(droplet("product-comments"));
  await rec.beat(1200);
  // A comment, posted: a WordPress comment, shown at once (site/init.sh).
  await postComment(page, rec);
  // The post ran once: one approved WordPress comment with that text.
  expect(await approvedComments(page.request, COMMENT.body)).toBe(1);

  // 3. Back to the gallery: three products into the cart, a toast for each.
  await rec.click(nav.getByRole("link", { name: "Gallery" }));
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(library.locator("article.card").first()).toBeVisible();
  await add(chosen, before + 1);
  const cart = (await page.context().cookies()).find((cookie) => cookie.name === "cart_id");
  expect(cart, "the cart cookie").toBeDefined();
  expect(cart!.httpOnly).toBe(true);
  expect(cart!.secure).toBe(secure);
  await add(second!, before + 2);
  await add(third!, before + 3);

  // 4. The cart.
  await rec.click(badge);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: chosen.name })).toBeVisible();
  await expect(drawer.getByText("Checking availability…")).toHaveCount(0);
  await rec.beat(1200);
  await rec.shot("2-cart");
  await rec.click(drawer.getByRole("button", { name: "Close" }));
  await expect(drawer).toHaveCount(0);

  // 5. WordPress's login, then wp-admin's Shop screen from its menu.
  await page.goto("/wp-admin/");
  await wpLogIn(page, rec);
  await expect(page).toHaveURL(/\/wp-admin\/$/);
  expect(await loginCookie(page), "WordPress's login cookie").toBeDefined();
  const menu = page.locator("#adminmenu #toplevel_page_droplets-shop > a");
  await expect(menu).toHaveText(/Shop/);
  await rec.click(menu);
  await expect(page).toHaveURL(AT_SHOP_SCREEN);
  await expect(page.locator("#droplets-shop-admin h1")).toHaveText("Shop: stock and prices");
  // Only the admin droplet is here: no toasts, no cart, no gallery.
  await expect(page.locator("djs-shop")).toHaveCount(1);
  const admin = page.locator(ADMIN_DROPLET);
  const row = admin.locator("tr", { has: page.getByLabel(`Stock of ${chosen.name}`, { exact: true }) });
  const stock = row.getByLabel(`Stock of ${chosen.name}`, { exact: true });
  await expect(stock).toBeVisible();
  // Hydrated, the admin's forms post by fetch (through the proxy) and render in place.
  await page.waitForLoadState("networkidle");
  await rec.fill(stock, "0");
  await rec.click(row.getByRole("button", { name: "Save" }));
  await expect(admin.getByRole("status")).toContainText("Saved");
  await expect(page).toHaveURL(AT_SHOP_SCREEN);
  await expect(admin.locator("tr", { has: page.getByLabel(`Stock of ${chosen.name}`, { exact: true }) }).locator("p.stock")).toHaveText("Out of stock");
  await rec.beat();
  await rec.shot("3-admin");

  // 6. Logged out, from the toolbar's account menu.
  await rec.hover(page.locator("#wp-admin-bar-my-account > .ab-item"));
  const logout = page.locator("#wp-admin-bar-logout a");
  await expect(logout).toBeVisible();
  await rec.click(logout);
  await expect(page).toHaveURL(/\/wp-login\.php\?loggedout=true/);
  expect(await loginCookie(page), "no login cookie").toBeUndefined();

  // 7. An anonymous visitor: the site, the gallery, the chosen product's page.
  await rec.click(page.locator("#backtoblog a"));
  await rec.click(nav.getByRole("link", { name: "Gallery" }));
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(cardOf(chosen).getByRole("button", { name: "Out of stock" })).toBeDisabled();
  await expect(badge.locator(".cart-count")).toHaveText(String(before + 3));
  await rec.click(cardOf(chosen).locator("h3.name a"));
  const [, slug] = PRODUCT_LINK.exec(chosen.href)!;
  await expect(page).toHaveURL(new RegExp(`/product/${slug}(?:\\?|$)`));
  await expect(product.locator("h1")).toHaveText(chosen.name);

  // 8. The cart, opened: its availability check marks the chosen product.
  await rec.click(badge);
  await expect(drawer).toBeVisible();
  const chosenLine = drawer.locator("li.cart-line", { has: page.getByRole("link", { name: chosen.name }) });
  await expect(chosenLine.locator(".stock-out")).toHaveText("Out of stock");
  await expect(drawer.getByRole("alert")).toContainText("out of stock");
  await rec.beat(1500);
  await rec.click(drawer.getByRole("button", { name: "Close" }));
  await expect(drawer).toHaveCount(0);

  // 9. And the page says so (stock is filled in per request on the prerendered page).
  await expect(product.locator("p.stock")).toHaveText("Out of stock");
  await expect(product.getByRole("button", { name: "Out of stock" })).toBeDisabled();
  await rec.reveal(product.locator("p.stock"));
  await rec.beat(800);
  await rec.shot("4-out-of-stock");
});

/** How many approved WordPress comments hold exactly `body` (the REST API's public list). */
async function approvedComments(request: APIRequestContext, body: string): Promise<number> {
  const answer = await request.get(`/wp-json/wp/v2/comments?${new URLSearchParams({ search: body, per_page: "100", _fields: "content" })}`);
  expect(answer.status()).toBe(200);
  const list = (await answer.json()) as Array<{ content: { rendered: string } }>;
  return list.filter(({ content }) => content.rendered.replace(/<[^>]*>/g, "").trim() === body).length;
}

/**
 * JavaScript off, the comment form posts natively: a 303 back to the
 * product page (Post/Redirect/Get) with the signed result in its query,
 * and the page, rendered again, lists the comment. A reload is a GET of
 * that page: it shows the same result and posts nothing again.
 */
test("without JavaScript, a comment posts once and shows after the redirect", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto("/gallery");
  const href = (await page.locator('djs-shop[data-droplet="product-library"] article.card h3.name a').last().getAttribute("href"))!;
  const [, slug] = PRODUCT_LINK.exec(href)!;
  // Newest first, so the new comment is on the page shown.
  await page.goto(`/product/${slug}?order=newest`);
  const comments = page.locator('djs-shop[data-droplet="product-comments"]');
  const body = "Second one I ordered. Still as good as the first, and the colour is spot on.";
  await comments.locator('input[name="author"]').fill("Andrei");
  await comments.locator('textarea[name="body"]').fill(body);

  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  const posted = page.waitForResponse((response) => response.request().method() === "POST");
  await comments.getByRole("button", { name: "Post comment" }).click();
  expect((await posted).status()).toBe(303);
  await expect(page).toHaveURL(new RegExp(`/product/${slug}\\?order=newest&(?:.*&)?__droplet_form_product-comments_[^=&]+=`));
  await expect(comments.getByRole("status")).toHaveText("Thanks, your comment is posted.");
  await expect(comments.locator("ol.list li").first()).toContainText(body);
  expect(posts).toHaveLength(1);
  expect(await approvedComments(context.request, body)).toBe(1);

  // A reload: a GET of the same page, the same result shown, nothing posted again.
  await page.reload();
  await expect(comments.locator("ol.list li", { hasText: body })).toHaveCount(1);
  expect(posts).toHaveLength(1);
  expect(await approvedComments(context.request, body)).toBe(1);
  await context.close();
});

/** A context of its own, logged in as `who` through wp-login.php (landing on `to`). */
async function loggedIn(browser: Browser, baseURL: string, who: { user: string; password: string }, to = "/wp-admin/") {
  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`/wp-login.php?${new URLSearchParams({ redirect_to: to })}`);
  await wpLogIn(page, { click: (target) => target.click(), fill: (target, value) => target.fill(value) }, who);
  await expect(page).toHaveURL(new RegExp(`${literal(to)}$`));
  return { context, page };
}

/** A REST nonce for the logged-in user of `request` (WordPress's own `rest-nonce` action). */
async function restNonce(request: APIRequestContext): Promise<string> {
  const answer = await request.get("/wp-admin/admin-ajax.php?action=rest-nonce");
  expect(answer.status()).toBe(200);
  const nonce = (await answer.text()).trim();
  expect(nonce).toMatch(/^[0-9a-f]{10}$/);
  return nonce;
}

const NO_REDIRECT = { maxRedirects: 0 } as const;

test("logged out, the Shop screen sends you to wp-login.php", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const answer = await context.request.get(SHOP_SCREEN, NO_REDIRECT);
  expect(answer.status()).toBe(302);
  expect(answer.headers()["location"]).toMatch(/\/wp-login\.php\?redirect_to=[^&]*admin\.php%3Fpage%3Ddroplets-shop/);
  expect(await answer.text()).not.toContain("product-admin");
  // The admin droplet's fragment, straight through the proxy: the gate, no products.
  const fragment = await context.request.get("/droplets/product-admin", { headers: { accept: "text/html" } });
  expect(fragment.status()).toBe(200);
  const html = await fragment.text();
  expect(html).toContain("Log in");
  expect(html).not.toContain("Stock of");
  await context.close();
});

test("a user who cannot manage_options is refused the Shop screen and its actions", async ({ browser, baseURL }) => {
  // The administrator makes an editor (WordPress's REST API, its nonce), removed at the end.
  const admin = await loggedIn(browser, baseURL!, ADMIN);
  const nonce = await restNonce(admin.context.request);
  const user = `editor-${Date.now().toString(36)}`;
  const password = `editor-password-${Date.now()}-x`;
  const created = await admin.context.request.post("/wp-json/wp/v2/users", {
    headers: { "x-wp-nonce": nonce },
    data: { username: user, email: `${user}@example.com`, password, roles: ["editor"] },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = (await created.json()) as { id: number };

  try {
    const editor = await loggedIn(browser, baseURL!, { user, password });
    // No Shop in the editor's menu, and the screen itself is refused.
    await expect(editor.page.locator("#adminmenu")).toBeVisible();
    await expect(editor.page.locator("#toplevel_page_droplets-shop")).toHaveCount(0);
    const screen = await editor.page.goto(SHOP_SCREEN);
    expect(screen?.status()).toBe(403);
    await expect(editor.page.locator("body")).toContainText("Sorry, you are not allowed to access this page.");
    await expect(editor.page.locator("djs-shop")).toHaveCount(0);

    // The proxy signs nothing for an editor: the fragment is the gate, and
    // a save, from this site's own origin, is refused by wp-shop.
    const fragment = await editor.context.request.get("/droplets/product-admin", { headers: { accept: "text/html" } });
    expect(await fragment.text()).not.toContain("Stock of");
    const save = await editor.context.request.post("/droplets/product-admin?/save", {
      headers: { accept: "application/json", origin: new URL(baseURL!).origin },
      form: { id: "x", stock: "0", price: "1.00" },
    });
    expect(save.status()).toBe(401);
    expect(await save.json()).toMatchObject({ type: "failure", status: 401, data: { reason: "login" } });
    await editor.context.close();
  } finally {
    const removed = await admin.context.request.delete(`/wp-json/wp/v2/users/${id}?force=true&reassign=1`, { headers: { "x-wp-nonce": nonce } });
    expect(removed.status(), await removed.text()).toBe(200);
    await admin.context.close();
  }
});

test("the admin's save needs this site's Origin, even logged in", async ({ browser, baseURL }) => {
  const admin = await loggedIn(browser, baseURL!, ADMIN);
  // Another origin: the proxy signs nothing (and wp-shop's own Origin check refuses it too).
  const save = await admin.context.request.post("/droplets/product-admin?/save", {
    headers: { accept: "application/json", origin: "http://elsewhere.example" },
    form: { id: "x", stock: "0", price: "1.00" },
  });
  expect(save.status()).toBeGreaterThanOrEqual(400);
  expect(await save.text()).not.toContain('"saved"');
  // A browser's own x-wp-shop-user is never passed on: still the gate for nobody.
  const visitor = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const forged = await visitor.request.get("/droplets/product-admin", { headers: { accept: "text/html", "x-wp-shop-user": "e30.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } });
  expect(await forged.text()).not.toContain("Stock of");
  await visitor.close();
  await admin.context.close();
});

test("no public page has the admin droplet, /admin included", async ({ browser, baseURL }) => {
  const expectNoAdmin = async (context: BrowserContext, path: string) => {
    const answer = await context.request.get(path, NO_REDIRECT);
    expect(await answer.text(), path).not.toContain('data-droplet="product-admin"');
    return answer;
  };
  // Nobody logged in: /admin (and /admin/) to the Shop screen, which asks for a login.
  const visitor = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  for (const path of ["/admin", "/admin/"]) {
    const answer = await expectNoAdmin(visitor, path);
    expect(answer.status(), path).toBe(302);
    expect(answer.headers()["location"], path).toMatch(AT_SHOP_SCREEN);
  }
  const page = await visitor.newPage();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/wp-login\.php\?/);
  await expect(page.locator("djs-shop")).toHaveCount(0);
  await visitor.close();

  // The administrator, logged in: /admin is still a redirect, and no public page renders the admin.
  const admin = await loggedIn(browser, baseURL!, ADMIN);
  const answer = await expectNoAdmin(admin.context, "/admin");
  expect(answer.status()).toBe(302);
  expect(answer.headers()["location"]).toMatch(AT_SHOP_SCREEN);
  for (const path of ["/gallery", "/cart", "/about", "/journal"]) {
    const page = await expectNoAdmin(admin.context, path);
    expect(page.status(), path).toBe(200);
  }
  await admin.context.close();
});

/**
 * Computed styles of every element `selectors` match, in document order,
 * for the properties that make a droplet's look and place. A link's
 * colour is the host's to choose (the droplet sets none), so it is left out.
 */
async function looks(page: Page, selectors: string[]): Promise<Record<string, Record<string, string>>> {
  return page.evaluate((selectors) => {
    const PROPERTIES = [
      "display", "position", "left", "visibility", "opacity",
      "font-family", "font-size", "font-weight", "line-height", "color", "background-color",
      "padding-top", "padding-right", "padding-bottom", "padding-left",
      "margin-top", "margin-bottom", "border-top-width", "border-left-width", "border-top-color",
      "border-top-left-radius", "box-shadow", "min-height", "box-sizing", "text-transform",
    ];
    const out: Record<string, Record<string, string>> = {};
    for (const selector of selectors) {
      const elements = [...document.querySelectorAll(selector)];
      if (elements.length === 0) throw new Error(`no ${selector}`);
      elements.forEach((element, index) => {
        const style = getComputedStyle(element);
        const names = element.localName === "a" ? PROPERTIES.filter((name) => name !== "color" && name !== "border-top-color") : PROPERTIES;
        out[`${selector} #${index} <${element.localName}>`] = Object.fromEntries(
          names.map((name) => [name, style.getPropertyValue(name)]),
        );
      });
    }
    return out;
  }, selectors);
}

test("wp-admin's styles stay out of the droplet, and the droplet's out of wp-admin", async ({ browser, baseURL }) => {
  const admin = await loggedIn(browser, baseURL!, ADMIN);
  const { page } = admin;

  // wp-admin's own frame, on the dashboard and on the Shop screen: the same.
  // A menu item that is current on neither screen.
  const CHROME = ["body", "#wpadminbar", "#menu-posts > a.menu-top", "#wpbody-content .wrap > h1", "#wpfooter"];
  await page.goto("/wp-admin/");
  const dashboard = await looks(page, CHROME);
  await page.goto(SHOP_SCREEN);
  await page.waitForLoadState("networkidle");
  expect(await looks(page, CHROME)).toEqual(dashboard);
  // The screen's stylesheet and the loader are on this screen only.
  await expect(page.locator('link[href*="shop-admin.css"]')).toHaveCount(1);
  await expect(page.locator('script[type="module"][src="/index.js"]')).toHaveCount(1);

  // The droplet in wp-admin, and the same fragment on a bare page of this
  // origin with nothing of WordPress's: the same look.
  // Every element of its intro, its table's head and first row: a class
  // name wp-admin styles too (`.button`, `.notice`, `.row-actions`) shows here.
  const DROPLET = [
    ADMIN_DROPLET,
    `${ADMIN_DROPLET} .who, ${ADMIN_DROPLET} .who *`,
    `${ADMIN_DROPLET} .products thead, ${ADMIN_DROPLET} .products thead *`,
    `${ADMIN_DROPLET} .products tbody tr:first-child, ${ADMIN_DROPLET} .products tbody tr:first-child *`,
  ];
  const inAdmin = await looks(page, DROPLET);
  const fragment = await admin.context.request.get("/droplets/product-admin", { headers: { accept: "text/html" } });
  const html = await fragment.text();
  expect(html).toContain("Stock of");
  const bare = new URL("/__droplets-bare-page", baseURL).href;
  await page.route(bare, (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>` }),
  );
  await page.goto(bare);
  await page.waitForLoadState("networkidle");
  expect(inAdmin).toEqual(await looks(page, DROPLET));
  await admin.context.close();
});

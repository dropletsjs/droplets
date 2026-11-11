import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, HOST, RECORDINGS, test, type Recorder } from "./record.ts";
import { loginCookie, SHOP_SCREEN, wpLogIn } from "./wordpress.ts";

/** `text` as a regular expression matches it, literally. */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A gallery link to a product page: its slug, and the page's version. */
const PRODUCT_LINK = /^\/product\/([a-z0-9-]+)\?v=([0-9a-f]{10})$/;

/**
 * The WordPress showcase (examples/wp-shop) has no shop login: the admin is
 * whoever is logged in to WordPress, and the plugin vouches for them with
 * a signed header on each request to the shop. Its admin is in wp-admin,
 * never on /admin: its own flow is shop-wordpress.spec.ts.
 */
const WORDPRESS = HOST.startsWith("wordpress");

/**
 * Logs in as the shop's admin from the admin's gate (its "Log in" link) and
 * lands back on /admin, at the shop's login droplet (admin / droplets, the
 * `shop_admin` cookie).
 */
async function logIn(page: Page, rec: Pick<Recorder, "click" | "fill">, secure: boolean) {
  await rec.click(page.locator('djs-shop[data-droplet="product-admin"]').getByRole("link", { name: "Log in" }));
  const login = page.locator('djs-shop[data-droplet="login"]');
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin$|\/login\?next=\/admin$/);
  await rec.fill(login.locator('input[name="user"]'), "admin");
  await rec.fill(login.locator('input[name="password"]'), "droplets");
  await rec.click(login.getByRole("button", { name: "Log in" }));
  await expect(page).toHaveURL(/\/admin$/);
  const session = (await page.context().cookies()).find((cookie) => cookie.name === "shop_admin");
  expect(session, "the admin session cookie").toBeDefined();
  expect(session!.httpOnly).toBe(true);
  expect(session!.secure).toBe(secure);
}

/** Plain clicks and fills, for the tests that are not recorded. */
const plain = {
  click: (target: Locator) => target.click(),
  fill: (target: Locator, value: string) => target.fill(value),
};

/**
 * The shop's admin, logged in: /admin and the shop's login, or on
 * WordPress the Shop screen in wp-admin, through wp-login.php (the same
 * demo account, WordPress's own cookie and no shop cookie at all).
 */
async function openAdmin(page: Page, rec: Pick<Recorder, "click" | "fill">, secure: boolean) {
  if (!WORDPRESS) {
    await page.goto("/admin");
    await logIn(page, rec, secure);
    return;
  }
  await page.goto(SHOP_SCREEN);
  await wpLogIn(page, rec);
  await expect(page).toHaveURL(new RegExp(`${literal(SHOP_SCREEN)}$`));
  expect(await loginCookie(page), "WordPress's login cookie").toBeDefined();
  expect(
    (await page.context().cookies()).find((cookie) => cookie.name === "shop_admin"),
    "no shop session",
  ).toBeUndefined();
}

/**
 * The shop demo on one host (run.mjs says which), in the order a visitor
 * would go: a few products into the cart (a glass among them, when the
 * catalogue has one), a product page read down to its comments, one more
 * product, a look at the cart; then the admin sets the glass's stock to 0,
 * the cart says so when it opens again, and so does the glass's page.
 * Every page is the host's own; the droplets come through it. Not on
 * WordPress, whose admin is in wp-admin: shop-wordpress.spec.ts has its
 * flow (and the recording; declared skipped, this one opens no page).
 */
(WORDPRESS ? test.skip : test)("the shop flow", async ({ page, rec, baseURL }) => {
  const secure = new URL(baseURL!).protocol === "https:";
  const droplet = (id: string) => page.locator(`djs-shop[data-droplet="${id}"]`);
  const library = droplet("product-library");
  const cartDroplet = droplet("shopping-cart");
  const badge = cartDroplet.locator(".cart-badge");
  const drawer = cartDroplet.getByRole("dialog", { name: "Your cart" });
  const toasts = droplet("toast-center");
  const nav = page.locator("header nav");

  // 1. The gallery, rendered on the server, then hydrated: the library's
  //    no-JavaScript Sort button goes once it is live.
  await page.goto("/gallery");
  await expect(page.locator("main h1").first()).toHaveText("Everything a demo shop needs.");
  await expect(library.locator("article.card").first()).toBeVisible();
  await expect(library.getByRole("button", { name: "Sort" })).toHaveCount(0);
  await expect(badge).toBeVisible();
  // The toasts come first, once: their script installs the page's message queue.
  await expect(page.locator("djs-shop").first()).toHaveAttribute("data-droplet", "toast-center");
  await expect(toasts).toHaveCount(1);
  const count = async () => ((await badge.locator(".cart-count").count()) ? Number(await badge.locator(".cart-count").textContent()) : 0);
  const before = await count();
  await rec.beat();
  await rec.shot("1-gallery");

  // The cards that can be bought, by their links: a card's button changes name once added.
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
  const [second, third, fourth] = offered.filter((product) => product !== chosen);
  const cardOf = ({ href }: { href: string }) => library.locator("article.card", { has: page.locator(`h3.name a[href="${href}"]`) });
  const add = async (product: { name: string; href: string }, total: number) => {
    const card = cardOf(product);
    await rec.click(card.getByRole("button", { name: "Add to cart" }));
    await expect(card.getByRole("button", { name: "✓ Added" })).toBeVisible();
    await expect(badge.locator(".cart-count")).toHaveText(String(total));
    // A toast says it, in the corner; nothing is written under the button.
    await expect(toasts.getByRole("status").filter({ hasText: `${product.name} added to your cart` })).toBeVisible();
    await expect(card.locator("form").getByRole("status")).toHaveCount(0);
    await expect(card.locator("form .notice")).toHaveCount(0);
  };

  // 2. Three products into the cart, the chosen one first: the badge counts them.
  await add(chosen, before + 1);
  const cart = (await page.context().cookies()).find((cookie) => cookie.name === "cart_id");
  expect(cart, "the cart cookie").toBeDefined();
  expect(cart!.httpOnly).toBe(true);
  expect(cart!.secure).toBe(secure);
  await add(second!, before + 2);
  await add(third!, before + 3);

  // 3. A product page, read down to its comments and back up.
  await rec.click(cardOf(second!).locator("h3.name a"));
  await expect(page).toHaveURL(new RegExp(`${literal(second!.href)}$`));
  const product = droplet("product-page");
  await expect(product.locator("h1")).toHaveText(second!.name);
  await expect(droplet("product-comments")).toBeAttached();
  await rec.scrollThrough();

  // 4. Back to the gallery: one more product.
  await rec.click(nav.getByRole("link", { name: "Gallery" }));
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(library.locator("article.card").first()).toBeVisible();
  await add(fourth!, before + 4);

  // 5. The cart: its lines, then closed.
  await rec.click(badge);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: chosen.name })).toBeVisible();
  await expect(drawer.getByText("Checking availability…")).toHaveCount(0);
  await rec.beat(1200);
  await rec.shot("2-cart");
  await rec.click(drawer.getByRole("button", { name: "Close" }));
  await expect(drawer).toHaveCount(0);

  // 6. The admin: the gate, the login (the shop's, a 303 back to /admin
  //    with the session cookie), then the chosen product's stock set to 0.
  await rec.click(nav.getByRole("link", { name: "Admin" }));
  await expect(page).toHaveURL(/\/admin$/);
  await logIn(page, rec, secure);

  const admin = droplet("product-admin");
  const stock = admin.getByLabel(`Stock of ${chosen.name}`, { exact: true });
  await expect(stock).toBeVisible();
  // Hydrated, the admin's forms post by fetch and render in place.
  await page.waitForLoadState("networkidle");
  await rec.fill(stock, "0");
  await rec.click(
    admin.locator("form", { has: page.getByLabel(`Stock of ${chosen.name}`, { exact: true }) }).getByRole("button", { name: "Save" }),
  );
  await expect(admin.getByRole("status")).toContainText("Saved");
  await expect(admin.locator("tr", { has: page.getByLabel(`Stock of ${chosen.name}`, { exact: true }) }).locator("p.stock")).toHaveText(
    "Out of stock",
  );
  await rec.beat();
  await rec.shot("3-admin");

  // 7. Out of the admin, to a product page: the gallery's card says it, and
  //    the cart, opened, checks its lines and marks the chosen one.
  await rec.click(nav.getByRole("link", { name: "Gallery" }));
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(cardOf(chosen).getByRole("button", { name: "Out of stock" })).toBeDisabled();
  await expect(badge.locator(".cart-count")).toHaveText(String(before + 4));
  await rec.click(cardOf(third!).locator("h3.name a"));
  await expect(page).toHaveURL(new RegExp(`${literal(third!.href)}$`));
  await expect(product.locator("h1")).toHaveText(third!.name);
  await rec.click(badge);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Checking availability…").first()).toBeVisible();
  const chosenLine = drawer.locator("li.cart-line", { has: page.getByRole("link", { name: chosen.name }) });
  await expect(chosenLine.locator(".stock-out")).toHaveText("Out of stock");
  await expect(drawer.getByRole("alert")).toContainText("out of stock");
  await rec.beat(1500);

  // 8. Its page says so too (stock is filled in per request on the prerendered page).
  await rec.click(chosenLine.getByRole("link", { name: chosen.name }));
  const [, slug] = PRODUCT_LINK.exec(chosen.href)!;
  await expect(page).toHaveURL(new RegExp(`/product/${slug}(?:\\?|$)`));
  await expect(product.locator("h1")).toHaveText(chosen.name);
  await expect(product.locator("p.stock")).toHaveText("Out of stock");
  await expect(product.getByRole("button", { name: "Out of stock" })).toBeDisabled();
  await rec.beat(800);
  await rec.shot("4-out-of-stock");
});

/**
 * The product page ships no JavaScript of its own: its form is enhanced by
 * /index.js, and the toast center relays the add's result as a toast. No
 * message sits under the button; the button says it.
 */
test("the product page's add to cart shows a toast", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto("/gallery");
  const card = page
    .locator('djs-shop[data-droplet="product-library"] article.card')
    .filter({ has: page.getByRole("button", { name: "Add to cart" }) })
    .first();
  const name = (await card.locator("h3.name a").textContent())!.trim();
  await page.goto((await card.locator("h3.name a").getAttribute("href"))!);
  const product = page.locator('djs-shop[data-droplet="product-page"]');
  const toasts = page.locator('djs-shop[data-droplet="toast-center"]');
  await expect(page.locator("djs-shop").first()).toHaveAttribute("data-droplet", "toast-center");
  await page.waitForLoadState("networkidle");
  await product.getByRole("button", { name: "Add to cart" }).click();

  const toast = toasts.getByRole("status").filter({ hasText: `${name} added to your cart` });
  await expect(toast).toBeVisible();
  await expect(product.getByRole("button", { name: "✓ Added" })).toBeVisible();
  await expect(product.getByRole("status")).toHaveCount(0);
  await expect(product.locator(".notice")).toHaveCount(0);
  // Its close button takes it away.
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(toast).toHaveCount(0);
  await context.close();
});

/**
 * JavaScript off: a native post to the product page's `?/add` answers 303
 * back to the host page (Post/Redirect/Get), the signed result in its query;
 * the host renders that page again, passing its URL on, and the droplet
 * shows the result on its button. No toast: that needs JavaScript.
 */
test("without JavaScript, add to cart lands back on the host page", async ({ browser, baseURL }) => {
  test.skip(HOST.startsWith("react"), "the SPA renders its pages in the browser: nothing to show without JavaScript");
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  await page.goto("/gallery");
  const card = page
    .locator('djs-shop[data-droplet="product-library"] article.card')
    .filter({ has: page.getByRole("button", { name: "Add to cart" }) })
    .first();
  const href = (await card.locator("h3.name a").getAttribute("href"))!;
  await page.goto(href);
  const product = page.locator('djs-shop[data-droplet="product-page"]');
  await product.getByRole("button", { name: "Add to cart" }).click();

  await expect(page).toHaveURL(new RegExp(`^${literal(`${baseURL}${href}`)}&(?:.*&)?__droplet_form_product-page_[^=&]+=`));
  await expect(product.getByRole("button", { name: "✓ Added" })).toBeVisible();
  await expect(product.getByRole("status")).toHaveCount(0);
  await expect(page.locator('djs-shop[data-droplet="toast-center"] .toast')).toHaveCount(0);
  await expect(page.locator("footer .shop-stack")).toBeVisible();
  await page.screenshot({ path: join(RECORDINGS, HOST, "5-no-javascript.png") });
  await context.close();
});

/**
 * After the flow, a new visitor: no cart, no admin session. A host that
 * remembered the shop's cookies server-side (one HTTP client's cookie jar
 * for every visitor) would hand them someone else's.
 */
test("a new visitor gets nobody else's cart or session", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const cart = (await (await page.request.get("/api/cart")).json()) as { cart?: { count?: number } };
  expect(cart.cart?.count ?? 0).toBe(0);
  const me = (await (await page.request.get("/api/auth/me")).json()) as { admin?: unknown };
  expect(me.admin ?? null).toBeNull();
  await page.goto("/admin");
  if (WORDPRESS) {
    // No admin page: /admin is the Shop screen in wp-admin, which asks for a login.
    await expect(page).toHaveURL(/\/wp-login\.php\?/);
    await expect(page.locator('djs-shop[data-droplet="product-admin"]')).toHaveCount(0);
  } else {
    await expect(page.locator('djs-shop[data-droplet="product-admin"]').getByRole("link", { name: "Log in" })).toBeVisible();
  }
  await context.close();
});

/**
 * Stale-free SSG: the gallery links each product page with its version
 * (`?v=`), which the build prerendered. An admin edit changes it, so the
 * gallery's new link renders live with the new name; the old link (a
 * bookmark, a cache) redirects to the page without `v`, which always
 * renders live.
 */
test("an edited product's page is never stale", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const droplet = (id: string) => page.locator(`djs-shop[data-droplet="${id}"]`);
  const library = droplet("product-library");
  const product = droplet("product-page");

  // 1. The gallery's link: the version the build prerendered.
  await page.goto("/gallery");
  const first = library.locator("article.card h3.name a").first();
  const oldHref = (await first.getAttribute("href"))!;
  const [, slug] = PRODUCT_LINK.exec(oldHref) ?? [];
  expect(slug, oldHref).toBeDefined();
  const name = (await first.textContent())!.trim();
  const renamed = `${name} (edited)`;

  // 2. The admin renames it: in the admin droplet's form, or on WordPress
  //    in wp-admin, where the row's Edit link opens the product's post.
  await openAdmin(page, plain, new URL(baseURL!).protocol === "https:");
  const admin = droplet("product-admin");
  await admin
    .locator("tr", { has: page.getByLabel(`Stock of ${name}`, { exact: true }) })
    .getByRole("link", { name: "Edit" })
    .click();
  if (WORDPRESS) {
    await expect(page.locator("#title")).toHaveValue(name);
    await page.locator("#title").fill(renamed);
    await page.locator("#publish").click();
    await expect(page.locator("#message")).toContainText("updated");
  } else {
    await expect(admin.locator('input[name="name"]')).toHaveValue(name);
    await page.waitForLoadState("networkidle");
    await admin.locator('input[name="name"]').fill(renamed);
    await admin.locator("form.product-form").getByRole("button", { name: "Save" }).click();
    await expect(admin.getByRole("status")).toContainText("Saved");
  }

  // 3. The gallery links a new version; its page renders live, renamed.
  //    An edit in wp-admin reaches wp-shop within its catalogue's second
  //    (examples/wp-shop/src/lib/server/site.ts): the gallery, loaded again until then.
  const link = library.locator(`article.card h3.name a[href^="/product/${slug}?"]`);
  await expect(async () => {
    await page.goto("/gallery");
    await expect(link).toHaveText(renamed, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  const newHref = (await link.getAttribute("href"))!;
  expect(newHref).toMatch(PRODUCT_LINK);
  expect(newHref).not.toBe(oldHref);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${literal(newHref)}$`));
  await expect(product.locator("h1")).toHaveText(renamed);

  // 4. The old link: redirected to the page without `v`, live, renamed.
  await page.goto(oldHref);
  await expect(page).toHaveURL(new RegExp(`/product/${slug}$`));
  await expect(product.locator("h1")).toHaveText(renamed);

  // 5. The canonical URL, as shared: live.
  await page.goto(`/product/${slug}`);
  await expect(product.locator("h1")).toHaveText(renamed);
  await context.close();
});

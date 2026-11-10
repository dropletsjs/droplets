import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The WordPress showcase's admin: the Shop screen in wp-admin
 * (plugin/droplets-embed/shop-admin.php), for a user who can
 * `manage_options`. No public page has it.
 */
export const SHOP_SCREEN = "/wp-admin/admin.php?page=droplets-shop";

/** The demo administrator (site/init.sh; demo values only). */
export const ADMIN = { user: "admin", password: "droplets" } as const;

type Typist = { click(target: Locator): Promise<void>; fill(target: Locator, value: string): Promise<void> };

/** Fills in wp-login.php and submits it; the caller says where it should land. */
export async function wpLogIn(page: Page, rec: Typist, { user, password }: { user: string; password: string } = ADMIN) {
  await expect(page).toHaveURL(/\/wp-login\.php(?:\?|$)/);
  await rec.fill(page.locator("#user_login"), user);
  await rec.fill(page.locator("#user_pass"), password);
  await rec.click(page.locator("#wp-submit"));
}

/** WordPress's login cookie, if the context has one. */
export async function loginCookie(page: Page) {
  return (await page.context().cookies()).find((cookie) => cookie.name.startsWith("wordpress_logged_in_"));
}

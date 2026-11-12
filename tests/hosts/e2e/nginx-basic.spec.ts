import { expect, HOST, test } from "./record.ts";

/**
 * examples/hosts/nginx's basic page (the Svelte example behind the proxy on
 * the droplets port, 8080 by default): `/index.js` imports `./env.js`, so a
 * proxy that forwards `/index.js` without `/env.js` leaves every droplet
 * server HTML. Only on that host; the shop flow covers its other server.
 */
test.skip(!HOST.startsWith("nginx"), "the nginx host only");

/** The basic page, as the browser reaches it (run.mjs sets DROPLETS_URL under HOSTS_PORT_BASE). */
const BASIC = process.env["DROPLETS_URL"] ?? "http://localhost:8080";

// No `page`: a page is recorded, and its video would take the flow's place.
test("the basic page's droplets hydrate through the proxy", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASIC });
  const page = await context.newPage();
  const card = (mode: string) => page.locator(`djs-svelte[data-droplet="${mode}"] article[data-mode="${mode}"]`);

  // What /index.js imports comes through the proxy, from the droplets server.
  const env = await page.request.get("/env.js");
  expect(env.status()).toBe(200);
  expect(env.headers()["content-type"]).toContain("javascript");
  const css = await page.request.get("/index.css");
  expect(css.status()).toBe(200);
  expect(css.headers()["content-type"]).toContain("text/css");

  await page.goto("/");
  await expect(card("ssr-hydrate").getByTestId("rendered")).toContainText("on the server");
  await expect(card("ssr-hydrate").getByTestId("hydrated")).toHaveText("yes");
  await expect(card("client").getByTestId("rendered")).toHaveText("in the browser");
  await expect(card("ssr-nohydrate").getByTestId("hydrated")).toHaveText("no");
  await context.close();
});

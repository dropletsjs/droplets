/**
 * What only the Lit example has: components in declarative shadow DOM.
 * The server's shadow root is in the HTML; the browser adopts it without
 * rendering again; a fragment inserted with innerHTML (whose shadow root
 * the parser leaves inert) still comes alive; forms in a shadow root post,
 * enhanced or not; the error page brings its styles; and an "interactive"
 * droplet replays the click that woke it on the node inside the shadow root.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { dropletsPort } from "./examples.ts";

const droplets = `http://localhost:${dropletsPort("lit")}`;
const TAG = "djs-lit-ssr-hydrate";

const card = (page: Page, mode: string) => page.locator(`[data-testid="card"][data-mode="${mode}"]`);

/** Holds a droplet's client.js until `release()`: the page shows server markup meanwhile. */
async function holdBundle(page: Page, droplet: string): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.origin === droplets && url.pathname === `/droplets/${droplet}/client.js`,
    async (route: Route) => {
      await gate;
      await route.continue();
    },
  );
  return release;
}

/** Page errors and console errors, for the end of a test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("the server markup carries the shadow root as a declarative template, hydration deferred", async ({ request }) => {
  const html = await (await request.get(`${droplets}/droplets/ssr-hydrate?who=Ana`)).text();
  // The element waits for the renderer (`defer-hydration`), its shadow root
  // is a <template shadowrootmode> with the component's styles in it.
  expect(html).toMatch(new RegExp(`<${TAG}\\s+defer-hydration><template shadowroot="open" shadowrootmode="open"><style>`));
  // The host's children go in light DOM, after the shadow root: a <slot> shows them.
  expect(html).toMatch(new RegExp(`</template><div data-droplet-children style="display: contents"></div></${TAG}>`));
  expect(html.replace(/<!--[^>]*-->/g, "")).toContain("Hello Ana!");
  // A droplet without JavaScript is the same markup, minus nothing: the parser attaches it.
  const still = await (await request.get(`${droplets}/droplets/ssr-nohydrate`)).text();
  expect(still).toContain('<djs-lit-ssr-nohydrate    defer-hydration><template shadowroot="open" shadowrootmode="open">');
});

test("hydrates in place: the nodes the server rendered stay, nothing is rendered again", async ({ page }) => {
  const errors = watchErrors(page);
  const release = await holdBundle(page, "ssr-hydrate");
  await page.goto("");
  const it = card(page, "ssr-hydrate");
  // Parsed as a document: the browser attached the shadow root before any script.
  await expect(it.getByTestId("hydrated")).toHaveText("no");
  await page.evaluate((tag) => {
    const element = document.querySelector(tag)!;
    const root = element.shadowRoot!;
    const added: Node[] = [];
    const removed: Node[] = [];
    new MutationObserver((records) => {
      for (const record of records) {
        added.push(...record.addedNodes);
        removed.push(...record.removedNodes);
      }
    }).observe(root, { childList: true, subtree: true });
    Object.assign(window, {
      before: { root, article: root.querySelector("article"), count: root.querySelector("[data-testid=count]") },
      changes: { added, removed },
      deferred: element.hasAttribute("defer-hydration"),
    });
  }, TAG);
  expect(await page.evaluate(() => (window as unknown as { deferred: boolean }).deferred)).toBe(true);

  release();
  await expect(it.getByTestId("hydrated")).toHaveText("yes");
  const after = await page.evaluate((tag) => {
    const element = document.querySelector(tag)!;
    const root = element.shadowRoot!;
    const { before, changes } = window as unknown as {
      before: { root: ShadowRoot; article: Element; count: Element };
      changes: { added: Node[]; removed: Node[] };
    };
    return {
      sameRoot: before.root === root,
      sameArticle: before.article === root.querySelector("article"),
      sameCount: before.count === root.querySelector("[data-testid=count]") && before.count.isConnected,
      added: changes.added.length,
      removed: changes.removed.length,
      deferred: element.hasAttribute("defer-hydration"),
    };
  }, TAG);
  // "Hydrated: yes" is a text change; no element was added or removed.
  expect(after).toEqual({ sameRoot: true, sameArticle: true, sameCount: true, added: 0, removed: 0, deferred: false });

  // And it is live: the button inside the shadow root bumps the shared counter.
  const before = Number(await it.getByTestId("count").textContent());
  await it.getByTestId("bump").click();
  await expect(it.getByTestId("count")).not.toHaveText(String(before));
  expect(errors).toEqual([]);
});

test("a fragment inserted with innerHTML gets its shadow root attached, then hydrates", async ({ page }) => {
  const errors = watchErrors(page);
  const release = await holdBundle(page, "ssr-hydrate");
  await page.goto("inserted");
  await page.waitForFunction((tag) => document.querySelector(tag) !== null, TAG);
  // innerHTML runs no parser for declarative shadow DOM: the template is inert, there is no shadow root.
  expect(
    await page.evaluate((tag) => {
      const element = document.querySelector(tag)!;
      return { shadow: element.shadowRoot !== null, inert: element.querySelectorAll(":scope > template[shadowrootmode]").length };
    }, TAG),
  ).toEqual({ shadow: false, inert: 1 });

  release();
  const it = card(page, "ssr-hydrate");
  await expect(it.getByTestId("hydrated")).toHaveText("yes");
  await expect(it.locator(".card-greeting")).toHaveText("Hello Inserted!");
  expect(
    await page.evaluate((tag) => {
      const element = document.querySelector(tag)!;
      return {
        shadow: element.shadowRoot !== null,
        inert: document.querySelectorAll("template[shadowrootmode]").length,
        deferred: element.hasAttribute("defer-hydration"),
      };
    }, TAG),
  ).toEqual({ shadow: true, inert: 0, deferred: false });
  // The styles came with the template: the card is styled inside its shadow root.
  await expect(it).toHaveCSS("border-radius", "12px");
  const before = Number(await it.getByTestId("count").textContent());
  await it.getByTestId("bump").click();
  await expect(it.getByTestId("count")).not.toHaveText(String(before));
  expect(errors).toEqual([]);
});

test("a form in the shadow root runs its action: enhanced in place, and as a plain post", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("one/guestbook");
  const book = page.getByTestId("guestbook");
  await expect(book.getByTestId("form-result")).toHaveText("Nobody signed yet.");
  // enhance() binds as the element hydrates: wait for its first update.
  await page.waitForFunction(() => (document.querySelector("djs-lit-guestbook") as { hasUpdated?: boolean } | null)?.hasUpdated === true);

  const enhanced = book.getByTestId("enhanced");
  const answer = page.waitForResponse((r) => r.url().startsWith(`${droplets}/droplets/guestbook`) && r.request().method() === "POST");
  await enhanced.getByRole("textbox").fill("Ana");
  await enhanced.getByRole("button").click();
  expect((await answer).headers()["content-type"]).toContain("application/json");
  await expect(book.getByTestId("form-result")).toHaveText("Thanks, Ana!");
  // Rendered again with `form`, on the same page.
  expect(new URL(page.url()).pathname).toBe("/lit/one/guestbook");
  await page.waitForFunction(() => (document.querySelector("djs-lit-guestbook") as { hasUpdated?: boolean } | null)?.hasUpdated === true);
  await book.getByTestId("enhanced").getByRole("button").click();
  await expect(book.getByTestId("form-result")).toHaveText("A name, please.");

  // Not enhanced: the browser posts the form and shows what the action
  // answered, the droplet's fragment with `form`, as a page of its own.
  const plain = book.getByTestId("plain");
  await plain.getByRole("textbox").fill("Bo");
  await Promise.all([page.waitForURL(`${droplets}/droplets/guestbook**`), plain.getByRole("button").click()]);
  await expect(page.getByTestId("form-result")).toHaveText("Thanks, Bo!");
  // The empty name's 422, which the browser reports as it would any.
  expect(errors.filter((error) => !error.includes("status of 422"))).toEqual([]);
});

test("the error page renders in its own shadow root, with its styles, and hydrates", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("one/ssr-hydrate?who=crash");
  const error = page.getByTestId("error-page");
  await expect(error).toContainText("Something went wrong loading this droplet.");
  await expect(error).not.toContainText("Asked to crash.");
  // Its styles travel in the template; app.css's custom property crosses into the shadow root.
  await expect(error.locator(".card-error")).toHaveCSS("color", "rgb(190, 18, 60)");
  await page.waitForFunction(() => {
    const element = document.querySelector("djs-lit-ssr-hydrate--error") as (Element & { hasUpdated?: boolean }) | null;
    return element?.hasUpdated === true && !element.hasAttribute("defer-hydration");
  });
  expect(errors).toEqual([]);
});

test("hydrate=interactive: the first click, inside the shadow root, wakes the droplet and is replayed there", async ({ page }) => {
  const errors = watchErrors(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("one/ssr-hydrate?hydrate=interactive");
  const it = card(page, "ssr-hydrate");
  await expect(it.getByTestId("hydrated")).toHaveText("no");
  await page.waitForLoadState("networkidle");
  expect(requests.filter((url) => url.includes("/droplets/ssr-hydrate/client.js"))).toEqual([]);
  // The custom property set in app.css (light DOM) styles the badge in the shadow root.
  await expect(it.locator(".card-framework")).toHaveCSS("background-color", "rgb(50, 79, 255)");

  const before = Number(await it.getByTestId("count").textContent());
  const bumped = page.waitForResponse((r) => r.url() === `${droplets}/api/counter` && r.request().method() === "POST");
  await it.getByTestId("bump").click();
  const { count } = (await (await bumped).json()) as { count: number };
  expect(count).toBeGreaterThan(before);
  await expect(it.getByTestId("hydrated")).toHaveText("yes");
  await expect(it.getByTestId("count")).toHaveText(String(count));
  expect(errors).toEqual([]);
});

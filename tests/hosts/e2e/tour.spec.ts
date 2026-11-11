import { postComment, TOUR_COMMENT } from "./comment.ts";
import { renderersFromSync, readFacts, shopSource, type DropletFacts } from "./droplet-facts.ts";
import { expect, HOST, test } from "./record.ts";
import { clearOverlay, focusDroplet, hideCaption, installOverlay, leaveDroplet, overlayLayout } from "./tour-overlay.ts";
import type { Page } from "@playwright/test";
import type { Recorder } from "./record.ts";

/**
 * The droplet tour (`pnpm test:hosts <host> --tour`): on the gallery and a
 * product page, the cursor rests on each droplet in turn; an outline marks
 * it and a caption says what droplets reports about it (droplet-facts.ts).
 * On the WordPress showcase the tour then posts a comment through the
 * comments droplet's form and shows it appear.
 * A recording only: recordings/tour-<host>.mp4, always paced as a person.
 *
 * Each droplet is shown once in the whole tour, by name: the header's cart
 * is the same droplet on every page, so the product page skips it, and a
 * second element of a droplet on one page would only repeat its facts.
 */
test.use({ recording: `tour-${HOST}`, human: true });

/** How long the caption stays on each droplet: time to read it. */
const READ_MS = [2600, 3200] as const;

/** Where the cursor rests on a droplet's box: a small one at its middle, a large one near its top left. */
function spotOn(rec: Recorder, box: { width: number; height: number }) {
  const small = box.width < 360 && box.height < 240;
  return small
    ? { x: 0.5 + rec.random(-0.1, 0.1), y: 0.5 + rec.random(-0.1, 0.1) }
    : { x: rec.random(0.25, 0.45), y: Math.min(0.45, rec.random(110, 170) / box.height) };
}

/** The droplets the tour has shown so far, by name. */
type Shown = Set<string>;

/** The label inside the viewport, its name whole (every name fits this tour's viewport) and clear of the caption. */
async function expectTidy(page: Page, droplet: string) {
  const layout = await overlayLayout(page);
  expect.soft(layout.tagInside, `${droplet}: the label inside the viewport`).toBe(true);
  expect.soft(layout.cut, `${droplet}: the label's name whole`).toBe(false);
  expect.soft(layout.clash, `${droplet}: the label clear of the caption`).toBe(false);
}

/**
 * Each droplet on the page not shown yet, in page order, but `later`: a
 * step after this one shows it (it counts in the page's total).
 */
async function tourPage(page: Page, rec: Recorder, renderers: Map<string, string>, shown: Shown, options: { later?: string } = {}) {
  await page.waitForLoadState("networkidle");
  await installOverlay(page);
  const { element, droplets } = await readFacts(page, renderers);
  const nodes = page.locator(`${element}[data-droplet]`);
  // Hidden ones (no box) have nothing to point at; they may show on a later page.
  const visible: number[] = [];
  for (const [index] of droplets.entries()) {
    const box = await nodes.nth(index).boundingBox();
    if (box && box.width >= 4 && box.height >= 4) visible.push(index);
  }
  const names = new Set<string>();
  const plan = visible.filter((index) => {
    const name = droplets[index]!.droplet;
    if (shown.has(name) || names.has(name)) return false;
    names.add(name);
    return true;
  });
  const now = plan.filter((index) => droplets[index]!.droplet !== options.later);
  const total = plan.length;
  for (const [step, index] of now.entries()) {
    const facts = droplets[index]!;
    const node = nodes.nth(index);
    await leaveDroplet(page);
    // Scrolled into view first (rec.hover), then outlined.
    const box = await node.boundingBox();
    await rec.hover(node, box ? spotOn(rec, box) : undefined);
    await focusDroplet(page, element, index, facts, `${step + 1} of ${total}`);
    shown.add(facts.droplet);
    await page.waitForTimeout(rec.random(...READ_MS));
    await expectTidy(page, facts.droplet);
  }
  await clearOverlay(page);
  return { element, droplets, place: `${total} of ${total}` };
}

/**
 * The comments droplet, outlined with its caption, then its form filled
 * in and posted with only the outline on (the caption would cover the
 * form), and the new comment shown in the list with the caption back.
 */
async function commentStep(page: Page, rec: Recorder, shown: Shown, element: string, droplets: DropletFacts[], place: string) {
  const index = droplets.findIndex((facts) => facts.droplet === "product-comments");
  expect(index, "a comments droplet on the product page").toBeGreaterThanOrEqual(0);
  expect(shown.has("product-comments"), "the comments droplet, not shown before").toBe(false);
  const facts = droplets[index]!;
  const node = page.locator(`${element}[data-droplet]`).nth(index);
  await rec.reveal(node);
  const box = await node.boundingBox();
  await rec.hover(node, box ? spotOn(rec, box) : undefined);
  await focusDroplet(page, element, index, facts, place);
  shown.add(facts.droplet);
  await page.waitForTimeout(rec.random(...READ_MS));
  await expectTidy(page, facts.droplet);
  await hideCaption(page);
  const item = await postComment(page, rec, TOUR_COMMENT);
  // Rendered again in place: the same outline, its caption back.
  await focusDroplet(page, element, index, facts, place);
  await rec.hover(item);
  await page.waitForTimeout(rec.random(...READ_MS));
  await expectTidy(page, facts.droplet);
  await clearOverlay(page);
}

test("the droplet tour", async ({ page, rec }) => {
  const renderers = renderersFromSync(shopSource(HOST));
  const shown: Shown = new Set();

  // The gallery: every droplet on it, in page order.
  await page.goto("/gallery");
  const library = page.locator('[data-droplet="product-library"]');
  await expect(library.locator("article.card").first()).toBeVisible();
  await tourPage(page, rec, renderers, shown);

  // A product page, from the gallery's link: the version the build prerendered.
  await page.evaluate(() => scrollTo({ top: 0, behavior: "smooth" }));
  await rec.beat();
  const link = library.locator("article.card h3.name a").first();
  await rec.click(link);
  await expect(page).toHaveURL(/\/product\/[a-z0-9-]+\?v=[0-9a-f]+$/);
  await expect(page.locator('[data-droplet="product-page"] h1')).toBeVisible();
  await rec.beat(1200);
  // On WordPress the comments droplet comes last, in the comment step.
  const wordpress = HOST.startsWith("wordpress");
  const { element, droplets, place } = await tourPage(page, rec, renderers, shown, wordpress ? { later: "product-comments" } : {});

  // On WordPress: a comment, posted through the comments droplet.
  if (wordpress) await commentStep(page, rec, shown, element, droplets, place);

  await page.evaluate(() => scrollTo({ top: 0, behavior: "smooth" }));
  await rec.beat(1000);
});

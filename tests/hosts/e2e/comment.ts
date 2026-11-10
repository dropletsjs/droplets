import { expect, type Locator, type Page } from "@playwright/test";
import type { Recorder } from "./record.ts";

/** A visitor's comment, as the flow posts it. */
export const COMMENT = {
  author: "Maria",
  body: "Bought it as a gift and kept it for myself. Lovely quality, fast delivery.",
} as const;

/** The tour's, another visitor: WordPress refuses the same comment twice on one product. */
export const TOUR_COMMENT = {
  author: "Tom",
  body: "Arrived in two days, nicely packed. Exactly as in the photos.",
} as const;

/**
 * On a product page: the comments droplet's form, filled in and posted
 * (its `?/post` action, enhanced: by fetch once the droplet is live, which
 * renders it again in place with the result). Then the new comment in the
 * list: at the end of an oldest-first page that has room, else on top
 * once "Newest first" is chosen. Returns the comment's list item.
 *
 * The page's URL stays as it was: no form result in it, nothing a reload
 * would post again.
 */
export async function postComment(page: Page, rec: Recorder, comment: { author: string; body: string } = COMMENT): Promise<Locator> {
  const comments = page.locator('djs-shop[data-droplet="product-comments"]');
  const form = comments.locator("form.post");
  await rec.reveal(form);
  // Hydrated once visible: the total shows when it is live.
  await expect(comments.locator("h2 small")).toBeVisible();
  const before = page.url();

  await rec.fill(form.locator('input[name="author"]'), comment.author);
  await rec.fill(form.locator('textarea[name="body"]'), comment.body);
  await rec.click(form.getByRole("button", { name: "Post comment" }));
  await expect(form.getByRole("status")).toHaveText("Thanks, your comment is posted.");
  await rec.beat(900);

  const item = comments.locator("ol.list li", { hasText: comment.body });
  if (!(await item.isVisible())) await rec.click(comments.getByRole("link", { name: "Newest first" }));
  await expect(item).toBeVisible();
  await expect(item.locator(".meta b")).toHaveText(comment.author);
  await rec.reveal(item);
  await rec.hover(item);
  await rec.beat(1500);

  expect(page.url(), "the page's URL, unchanged by the post").toBe(before);
  expect(page.url()).not.toContain("__droplet_form_");
  return item;
}

/**
 * What counts as a page name for the page-view tracker: a short slug.
 * Shared by the droplet's props schema and `/api/page-views`, so both
 * refuse the same input.
 */
export const PAGE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `value` when it is a page name, else `null`. */
export function pageName(value: unknown): string | null {
  return typeof value === "string" && PAGE_NAME.test(value) ? value : null;
}

/** What `/api/page-views` answers, and what the droplet's load returns. */
export type PageViews = { page: string; views: number };

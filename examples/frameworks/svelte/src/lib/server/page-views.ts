/**
 * Page views per page name, in memory, for the whole server: the
 * page-views droplet reads them in its load, `/api/page-views` counts one
 * more. A `Map`, so no name reaches an object's prototype; capped, so a
 * stream of made-up names cannot grow it without end.
 */
const views = new Map<string, number>();
const MAX_PAGES = 1000;

export const viewsOf = (page: string): number => views.get(page) ?? 0;

/** One more view of `page`; `null` when the table is full and `page` is new. */
export function countView(page: string): number | null {
  if (!views.has(page) && views.size >= MAX_PAGES) return null;
  const next = viewsOf(page) + 1;
  views.set(page, next);
  return next;
}

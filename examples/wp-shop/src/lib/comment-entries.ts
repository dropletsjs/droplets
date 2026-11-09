import { COMMENT_PAGE_SIZES } from "./schemas.ts";

/**
 * Which product-comments renders are safe to prerender: "prerender what is
 * safe". With `oldest` first a new comment lands on the last page, so a
 * page that is already full at build (count ≥ page × showing) never changes
 * afterwards. Those pages, for every page size, are the entries; partial
 * pages, `newest` first and anything else render live. The total and "load
 * more" are not in these renders: the browser asks for them after hydrating.
 */
export function commentEntries(counts: Array<{ productId: string; count: number }>) {
  const entries: Array<{ props: { productId: string; order: "oldest"; page: number; showing: number } }> = [];
  for (const { productId, count } of counts) {
    for (const showing of COMMENT_PAGE_SIZES) {
      for (let page = 1; page * showing <= count; page++) {
        entries.push({ props: { productId, order: "oldest", page, showing } });
      }
    }
  }
  return entries;
}

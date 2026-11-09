import { categoriesWithCounts } from "../../lib/server/catalogue.ts";
import type { LoadEvent } from "./$types";

/** The categories with their counts, and the filter as the host's query has it. */
export const load = async ({ props, setHeaders }: LoadEvent) => {
  // The same for every visitor with the same query: a shared cache may keep it a minute.
  setHeaders({ "cache-control": "public, max-age=60" });
  return { categories: await categoriesWithCounts(), current: props };
};

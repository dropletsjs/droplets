import type { Entries } from "$droplets/server";
import { testimonialsPage } from "../../lib/server/testimonials.ts";
import { PAGES, type TestimonialsPage } from "../../lib/testimonials.ts";
import type { LoadEvent } from "./$types";

/**
 * Every page, rendered at build: `ssr = false`, so any other props answer 404.
 * Each is also written as `/assets/prerendered/testimonials-prerender-only/page-<n>`.
 */
export const entries = (() =>
  Array.from({ length: PAGES }, (_, i) => ({ props: { page: i + 1 }, file: `page-${i + 1}` }))) satisfies Entries;

/** The page from the data module itself: at build there is no request to answer. */
export const load = ({ props }: LoadEvent): TestimonialsPage => testimonialsPage(props.page);

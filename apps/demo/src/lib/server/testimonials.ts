import {
  DEFAULT_MAX,
  PAGE_SIZE,
  PAGES,
  type RandomTestimonials,
  TESTIMONIALS_COUNT,
  type Testimonial,
  type TestimonialsPage,
} from "../testimonials.ts";
import data from "./testimonials.json" with { type: "json" };

// The query is read key by key from URLSearchParams and checked against a
// fixed list: nothing from it is merged into an object, so `__proto__` is
// an unknown key like any other.

const ALL: readonly Testimonial[] = data;

/** What a query asks for, or why it is refused. */
export type TestimonialsQuery = { mode: "random"; max: number } | { mode: "page"; page: number } | { mode: "invalid"; message: string };

const KEYS: ReadonlySet<string> = new Set(["max", "random", "page"]);
const INTEGER = /^[1-9][0-9]{0,2}$/;

function integer(value: string, min: number, max: number): number | null {
  if (!INTEGER.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

/** `?max=N&random=true` (N 1–100, default 10) or `?page=P` (P 1–10); anything else is invalid. */
export function readTestimonialsQuery(params: URLSearchParams): TestimonialsQuery {
  const seen = new Map<string, string>();
  for (const [key, value] of params) {
    if (!KEYS.has(key)) return { mode: "invalid", message: `Unknown query key: use max and random=true, or page.` };
    if (seen.has(key)) return { mode: "invalid", message: `${key} is given twice.` };
    seen.set(key, value);
  }
  const page = seen.get("page");
  const random = seen.get("random");
  const max = seen.get("max");
  if (page !== undefined) {
    if (random !== undefined || max !== undefined)
      return { mode: "invalid", message: "Ask for page, or for max and random=true, not both." };
    const n = integer(page, 1, PAGES);
    return n === null ? { mode: "invalid", message: `page is an integer from 1 to ${PAGES}.` } : { mode: "page", page: n };
  }
  if (random !== "true") return { mode: "invalid", message: "Ask for ?page=P, or for ?max=N&random=true." };
  if (max === undefined) return { mode: "random", max: DEFAULT_MAX };
  const n = integer(max, 1, TESTIMONIALS_COUNT);
  return n === null ? { mode: "invalid", message: `max is an integer from 1 to ${TESTIMONIALS_COUNT}.` } : { mode: "random", max: n };
}

/** `count` distinct testimonials in random order. */
export function randomTestimonials(count: number): RandomTestimonials {
  const pool = [...ALL];
  const picked: Testimonial[] = [];
  while (picked.length < count && pool.length > 0) {
    const [item] = pool.splice(Math.floor(Math.random() * pool.length), 1);
    if (item) picked.push(item);
  }
  return { testimonials: picked };
}

/** Page `page` (1-based) in id order. */
export function testimonialsPage(page: number): TestimonialsPage {
  return { page, pages: PAGES, testimonials: ALL.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
}

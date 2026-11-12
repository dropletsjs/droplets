/**
 * The testimonials the five testimonials-* droplets show, as
 * `GET /api/testimonials` answers them (src/api/testimonials/+server.ts).
 * Fictional samples; the data lives in src/lib/server/testimonials.json.
 */
export type Testimonial = { id: number; author: string; text: string };

/** `?max=N&random=true`: N random, distinct items. */
export type RandomTestimonials = { testimonials: Testimonial[] };

/** `?page=P`: ten items in id order. */
export type TestimonialsPage = { page: number; pages: number; testimonials: Testimonial[] };

export const TESTIMONIALS_COUNT = 100;
export const PAGE_SIZE = 10;
export const PAGES = TESTIMONIALS_COUNT / PAGE_SIZE;
export const DEFAULT_MAX = 10;

/** The API path of ten random testimonials, as the droplets ask for it. */
export const RANDOM_PATH = `/api/testimonials?max=${DEFAULT_MAX}&random=true`;

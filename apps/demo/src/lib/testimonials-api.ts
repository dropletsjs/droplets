import droplet from "$droplets/drop";
import { RANDOM_PATH, type RandomTestimonials, type Testimonial } from "./testimonials.ts";

/** Ten random testimonials from the API on the droplet location: never the host page's origin. */
export async function fetchRandomTestimonials(): Promise<Testimonial[]> {
  const response = await fetch(droplet.url(RANDOM_PATH));
  if (!response.ok) throw new Error(`GET ${RANDOM_PATH} answered ${response.status}`);
  const body = (await response.json()) as RandomTestimonials;
  return body.testimonials;
}

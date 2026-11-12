import { error } from "$droplets/server";
import { RANDOM_PATH, type RandomTestimonials } from "../../lib/testimonials.ts";
import type { LoadEvent } from "./$types";

/** Ten random testimonials through `event.fetch`: a relative URL, answered by this server in-process. */
export const load = async ({ fetch }: LoadEvent): Promise<RandomTestimonials> => {
  const response = await fetch(RANDOM_PATH);
  if (!response.ok) error(502, "The testimonials API did not answer.");
  return (await response.json()) as RandomTestimonials;
};

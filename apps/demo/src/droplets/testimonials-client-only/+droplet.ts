import type { Testimonial } from "../../lib/testimonials.ts";
import { fetchAndStore, readStored } from "./store.ts";

/**
 * Runs in the browser only (`ssr = false`, no server file): the list kept in
 * IndexedDB, else ten random ones from the API on the droplet location,
 * kept for the next visit.
 */
export const load = async (): Promise<{ testimonials: Testimonial[]; from: "IndexedDB" | "the API" }> => {
  const stored = await readStored().catch(() => null);
  return stored ? { testimonials: stored, from: "IndexedDB" } : { testimonials: await fetchAndStore(), from: "the API" };
};

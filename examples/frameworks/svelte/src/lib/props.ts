import * as z from "zod/mini";

/**
 * The props of every droplet with a server load.
 * `+droplet.ts` exports it; it runs before any load (on the server, and in
 * the browser for a droplet no server rendered), and its output replaces the
 * props. A query string gives strings and a POST body gives any JSON: both
 * meet here, and anything else is answered 400 before a load runs.
 */
export const props = z.object({
  who: z._default(z.string().check(z.trim(), z.maxLength(200)), "world"),
});

export type Props = z.output<typeof props>;

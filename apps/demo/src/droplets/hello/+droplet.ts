import * as z from "zod/mini";

/**
 * `who`, from the query string (`?who=Ana`) or a POST body. Trimmed and
 * short; anything else is answered 400 before the load runs.
 */
export const props = z.object({
  who: z._default(z.string().check(z.trim(), z.minLength(1), z.maxLength(40)), "world"),
});

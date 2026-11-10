import * as z from "zod/mini";

/**
 * `fail`: `?fail=1` (or `true`) from a URL, `true` from a POST body. Off by
 * default; any other value is answered 400 before the load runs.
 */
export const props = z.object({
  fail: z._default(z.union([z.boolean(), z.enum(["0", "1", "false", "true"])]), false),
});

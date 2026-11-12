import * as z from "zod/mini";

/**
 * `page`: `?page=3`, or a number in a POST body; a positive integer up to
 * 100, else 400 before anything is looked up. Only pages 1 to 10 are
 * rendered at build (`entries`): `ssr = false`, so any other page is a 404.
 */
export const props = z.object({
  page: z.coerce.number().check(z.int(), z.minimum(1), z.maximum(100)),
});

import * as z from "zod/mini";
import { PAGE_NAME } from "../../lib/page-views.ts";

/**
 * Which page the tracker counts: a slug, `home` when left out. Checked
 * before the server load, as for any droplet; anything else answers 400.
 */
export const props = z.object({
  page: z._default(z.string().check(z.regex(PAGE_NAME)), "home"),
});

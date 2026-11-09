import type { HandleDropletError } from "$droplets/server";

// The same server load as every other server-rendered droplet.
export { load } from "../../lib/server/facts.ts";

/**
 * What `+error.vue` shows when the load throws. It runs on the server
 * only, so the original error never reaches the page.
 */
export const handleError = (() => ({
  // `satisfies`, not an annotation: the error page's `./$types` takes this shape.
  error: { message: "Something went wrong loading this droplet." },
})) satisfies HandleDropletError;

import type { Handle } from "$droplets/server";

/**
 * Keeps search engines from indexing the Worker's answers (fragments,
 * `_data`, the API) while still letting them fetch the docs' live droplets
 * to render those pages; the build's files get the same header from
 * `_headers`, since `handle` never runs for them.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set("x-robots-tag", "noindex");
  return response;
};

import type { DropletLoadEvent } from "./$types";

// Checks the caller's props before any load: the same schema as every server-rendered droplet.
export { props } from "../../lib/props.ts";

/**
 * Runs on both sides, after the server load: on the server before
 * rendering, in the browser before hydrating. Shapes server data for the
 * component without a second request.
 */
export const load = ({ data }: DropletLoadEvent) => ({
  ...data,
  who: data.who.trim() || "world",
});

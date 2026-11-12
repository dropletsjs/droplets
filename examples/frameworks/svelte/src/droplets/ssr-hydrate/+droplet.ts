import type { DropletLoadEvent } from "./$types";

// Checks the caller's props before any load: the same schema as every server-rendered droplet.
export { props } from "../../lib/props.ts";

/**
 * Runs on both sides, after the server load: on the server before
 * rendering, in the browser before hydrating or mounting. Shapes server
 * data for the component without a second request: the greeting the card shows.
 */
export const load = ({ data }: DropletLoadEvent) => ({ ...data, greeting: `Hello ${data.who}!` });

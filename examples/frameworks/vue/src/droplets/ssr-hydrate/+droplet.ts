import type { DropletLoadEvent } from "./$types";

// Checks the caller's props before any load: the same schema as every server-rendered droplet.
export { props } from "../../lib/props.ts";

/**
 * Runs after the server load, on the server before rendering: the browser
 * hydrates with its result, without a second request. It runs in the browser
 * only where no server did (a client-only mount, a refresh). Shapes server
 * data for the component: the greeting the card shows.
 */
export const load = ({ data }: DropletLoadEvent) => ({ ...data, greeting: `Hello ${data.who}!` });

import type { DropletLoadEvent } from "./$types";

// Checks the caller's props before any load: the same schema as every server-rendered droplet.
export { props } from "../../lib/props.ts";

/**
 * The same universal load as ssr-hydrate's, after the server load. Nothing
 * of this droplet runs in the browser, so here it runs on the server only.
 */
export const load = ({ data }: DropletLoadEvent) => ({ ...data, greeting: `Hello ${data.who}!` });

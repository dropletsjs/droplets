import { cardData } from "../../lib/card-data.ts";
import type { DropletLoadEvent } from "./$types";

// Checks the caller's props before any load: the same schema as every server-rendered droplet.
export { props } from "../../lib/props.ts";

/** Runs in the browser, over the server load's data (the droplet is client only): what the template shows. */
export const load = ({ data }: DropletLoadEvent) => cardData("client", data);

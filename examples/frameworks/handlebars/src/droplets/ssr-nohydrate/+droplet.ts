import { cardData } from "../../lib/card-data.ts";
import type { DropletLoadEvent } from "./$types";

// Checks the caller's props before any load: the same schema as every server-rendered droplet.
export { props } from "../../lib/props.ts";

/** Runs after the server load, on the server only: nothing of this droplet runs in the browser. */
export const load = ({ data }: DropletLoadEvent) => cardData("ssr-nohydrate", data);

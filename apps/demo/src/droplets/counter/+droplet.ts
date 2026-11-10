import * as z from "zod/mini";
import type { DropletLoadEvent } from "./$types";

/** Where the count starts: `?start=3`, or a number in a POST body. */
export const props = z.object({
  start: z._default(z.coerce.number().check(z.int(), z.minimum(-1000), z.maximum(1000)), 0),
});

/** No server load: the props are all it needs, on both sides. */
export const load = ({ props }: DropletLoadEvent) => ({ start: props.start });

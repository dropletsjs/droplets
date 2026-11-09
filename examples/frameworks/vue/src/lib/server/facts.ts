import { env } from "$droplets/env/private";
import { error, type LoadEvent } from "$droplets/server";
import type { Props } from "../props.ts";
import type { Facts, PrivateFacts } from "../types.ts";
import { readCount } from "./counter.ts";

/** What the private variables tell. Their values stay on the server. */
export const privateFacts = (): PrivateFacts => ({
  apiToken: env.API_TOKEN ? "set" : "not set",
  channel: env.BUILD_CHANNEL,
});

/**
 * The server load of every server-rendered droplet.
 * Its return value is inlined into the fragment, so hydration needs no
 * second round trip. The props went through `lib/props.ts` first.
 */
export const load = ({ props, locals }: LoadEvent): Facts => {
  const who = (props as Props).who || "world";
  // Answered as an endpoint does: a plain 404 with this message.
  if (who.length > 40) error(404, "Nobody with a name that long lives here.");
  // Any other throw is the droplet's to handle: ?who=crash shows the error page (+error.*).
  if (who === "crash") throw new Error("Asked to crash.");
  return {
    who,
    count: readCount(),
    renderedAt: new Date().toISOString(),
    requestId: locals.requestId,
    ...privateFacts(),
  };
};

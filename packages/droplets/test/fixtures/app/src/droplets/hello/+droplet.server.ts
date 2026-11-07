import { env } from "$droplets/env/private";
import { error, redirect, type HandleDropletError, type LoadEvent } from "$droplets/server";

export const load = ({ props, locals }: LoadEvent) => {
  if (props["who"] === "nobody") error(404, "Nobody is here");
  if (props["who"] === "away") redirect(303, "/elsewhere");
  if (props["who"] === "crash") throw new Error("database password is hunter2");
  return {
    who: typeof props["who"] === "string" ? props["who"] : "world",
    hooked: locals["hooked"] === true,
    secret: env.FIXTURE_SECRET ?? null,
    flag: env.FIXTURE_STATIC,
  };
};

// Server side: nothing of the original error leaves the server.
export const handleError: HandleDropletError = () => ({ error: { message: "Sorry, ref 42" } });

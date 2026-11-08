import { error, type HandleDropletError, type LoadEvent } from "$droplets/server";

export const load = ({ props }: LoadEvent) => {
  if (props["who"] === "nobody") error(404, "Nobody is here");
  if (props["who"] === "crash") throw new Error("database password is hunter2");
  return { who: typeof props["who"] === "string" ? props["who"] : "world" };
};

// Server side: nothing of the original error leaves the server.
export const handleError: HandleDropletError = () => ({ error: { message: "Sorry, ref 42" } });

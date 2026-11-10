import type { HandleDropletError } from "$droplets/server";
import type { LoadEvent } from "./$types";

/** Throws when asked to; otherwise says so. */
export const load = ({ props, setHeaders }: LoadEvent) => {
  if (props.fail === true || props.fail === "1" || props.fail === "true") {
    throw new Error("crash: the load threw because fail was set");
  }
  setHeaders({ "cache-control": "public, max-age=300" });
  return { renderedAt: new Date().toISOString() };
};

/**
 * What +error.tsx shows. It runs on the server only: the thrown error stays
 * in the log, and the page gets this fixed message.
 */
export const handleError = (() => ({
  error: { message: "The load threw. This is the droplet's +error page, rendered inside the same element." },
})) satisfies HandleDropletError;

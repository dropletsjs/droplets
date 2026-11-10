import type { LoadEvent } from "./$types";

/**
 * The greeting, on the server. The same for everyone who asks for the same
 * `who`, so a browser (or a cache in front) may keep it for five minutes.
 */
export const load = ({ props, setHeaders }: LoadEvent) => {
  setHeaders({ "cache-control": "public, max-age=300" });
  return { greeting: `Hello ${props.who}!`, renderedAt: new Date().toISOString() };
};

import type { LoadEvent } from "./$types";

/**
 * Runs on the server only. The count starts where the server says, and the
 * name of the framework comes with it. The same for everyone, so a browser
 * (or a cache in front) may keep it for five minutes.
 */
export const load = ({ setHeaders }: LoadEvent) => {
  setHeaders({ "cache-control": "public, max-age=300" });
  return { framework: "Preact", start: 3 };
};

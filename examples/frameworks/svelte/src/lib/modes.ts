import type { Mode } from "./types.ts";

/** The heading and the one-line explanation of each mode. */
export const MODES: Record<Mode, { title: string; summary: string }> = {
  client: {
    title: "client",
    summary: "ssr = false: rendered in the browser, its data fetched from /api.",
  },
  "ssr-hydrate": {
    title: "ssr + hydrate",
    summary: "Rendered on the server with its load, then hydrated: the counter talks to /api.",
  },
  "ssr-nohydrate": {
    title: "ssr only",
    summary: "hydrate = false: server HTML and no JavaScript. Reload to see the counter move.",
  },
};

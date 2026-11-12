// What both astro.config.mjs and scripts/og/render.mjs say about the site,
// so the share image never drifts from the pages' description.

export const title = "Droplets";

export const description =
  "Server-rendered components you can embed from any stack, as a Vite plugin on Hono. Svelte, Vue, Solid, React, Preact, Hono JSX, Handlebars or Lit.";

/** The share image in public/, drawn by scripts/og/render.mjs. */
export const ogImage = {
  file: "og.png",
  width: 1200,
  height: 630,
  alt: "Droplets: server-rendered components you can embed from any stack, as a Vite plugin on Hono.",
};

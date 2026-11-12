// What astro.config.mjs and scripts/og/render.mjs say about the site.

export const title = "Droplets";

/** Short enough that link previews show it whole (about 120 characters). */
export const description = "Server-rendered components you can embed from any stack, as a Vite plugin on Hono, in eight frameworks.";

/** The share image in public/, drawn by scripts/og/render.mjs. */
export const ogImage = {
  file: "og.png",
  tagline: "Server-rendered components you can embed from any stack, as a Vite plugin on Hono.",
  frameworks: ["Svelte", "Vue", "Solid", "React", "Preact", "Hono JSX", "Handlebars", "Lit"],
  width: 1200,
  height: 630,
  alt: "Droplets: server-rendered components you can embed from any stack, as a Vite plugin on Hono.",
};

import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { handlebars } from "@dropletsjs/renderer-handlebars";
import { honoJsx } from "@dropletsjs/renderer-hono-jsx";
import { react } from "@dropletsjs/renderer-react";
import { solid } from "@dropletsjs/renderer-solid";
import { svelte } from "@dropletsjs/renderer-svelte";
import { vue } from "@dropletsjs/renderer-vue";
import { dropletsDevtools } from "@dropletsjs/devtools";
import { node } from "@dropletsjs/adapter-node";

// Node: the cart is in SQLite (better-sqlite3). The catalogue and the
// comments are WordPress's, read over its REST API: `vite build` prerenders
// the product pages and the full comment pages from it, so the build needs
// WordPress up (WP_INTERNAL_URL). The container builds at start, once
// WordPress answers (scripts/start.sh).
export default defineConfig({
  plugins: [
    droplets({
      adapter: node(),
      renderers: [svelte(), vue(), react(), solid(), honoJsx(), handlebars()],
      css: { tailwind: false },
    }),
    dropletsDevtools(),
  ],
});

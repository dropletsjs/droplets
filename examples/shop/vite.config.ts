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

// Node only: the shop keeps its data in SQLite (better-sqlite3) and its
// images on disk. `vite build` emits dist/server.js; the prerendered product
// pages and comment pages read the seeded database at build.
export default defineConfig({
  plugins: [
    droplets({
      adapter: node(),
      renderers: [svelte(), vue(), react(), solid(), honoJsx(), handlebars()],
      // src/app.css: the shop's tokens and base styles, plain CSS.
      css: { tailwind: false },
    }),
    dropletsDevtools(),
  ],
});

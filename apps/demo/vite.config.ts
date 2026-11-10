import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { handlebars } from "@dropletsjs/renderer-handlebars";
import { honoJsx } from "@dropletsjs/renderer-hono-jsx";
import { lit } from "@dropletsjs/renderer-lit";
import { preact } from "@dropletsjs/renderer-preact";
import { react } from "@dropletsjs/renderer-react";
import { solid } from "@dropletsjs/renderer-solid";
import { svelte } from "@dropletsjs/renderer-svelte";
import { vue } from "@dropletsjs/renderer-vue";
import { dropletsDevtools } from "@dropletsjs/devtools";
import { node } from "@dropletsjs/adapter-node";
import { cloudflare } from "@dropletsjs/adapter-cloudflare";

// `vite build` emits dist/server.js for Node (local runs, the docs build,
// the tests); `DROPLETS_ADAPTER=cloudflare vite build` emits dist/worker.js
// for the dropletsjs-demo Worker (wrangler.jsonc).
const adapter = process.env["DROPLETS_ADAPTER"] === "cloudflare" ? cloudflare() : node();

export default defineConfig({
  plugins: [
    droplets({
      adapter,
      // Every renderer: React, Preact, Solid and Hono JSX share .tsx, and
      // each of those files names its own in an import and @jsxImportSource.
      renderers: [svelte(), react(), vue(), solid(), preact(), honoJsx(), handlebars(), lit()],
      // src/app.css: a few tokens, plain CSS, scoped to <djs-demo>.
      css: { tailwind: false },
    }),
    dropletsDevtools(),
  ],
});

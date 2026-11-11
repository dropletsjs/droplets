import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { node } from "@dropletsjs/adapter-node";
import { cloudflare } from "@dropletsjs/adapter-cloudflare";
import { dropletsDevtools } from "@dropletsjs/devtools";
import { handlebars } from "@dropletsjs/renderer-handlebars";
import { honoJsx } from "@dropletsjs/renderer-hono-jsx";
import { lit } from "@dropletsjs/renderer-lit";
import { preact } from "@dropletsjs/renderer-preact";
import { react } from "@dropletsjs/renderer-react";
import { solid } from "@dropletsjs/renderer-solid";
import { svelte } from "@dropletsjs/renderer-svelte";
import { vue } from "@dropletsjs/renderer-vue";

// React, Preact, Solid and Hono JSX share `.tsx` (each droplet says which
// with its `@jsxImportSource`); Vue's script blocks are TypeScript. The
// adapter is for test/production.test.ts, which builds it for Node and, with
// DROPLETS_ADAPTER=cloudflare, for Workers.
const adapter = process.env["DROPLETS_ADAPTER"] === "cloudflare" ? cloudflare() : node();

export default defineConfig({
  plugins: [
    droplets({ adapter, renderers: [react(), preact(), vue(), solid(), svelte(), lit(), honoJsx(), handlebars()] }),
    dropletsDevtools(),
  ],
});

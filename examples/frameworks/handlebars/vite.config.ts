import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { handlebars } from "@dropletsjs/renderer-handlebars";
import { dropletsDevtools } from "@dropletsjs/devtools";
import { node } from "@dropletsjs/adapter-node";
import { cloudflare } from "@dropletsjs/adapter-cloudflare";
import { bun } from "@dropletsjs/adapter-bun";
import { deno } from "@dropletsjs/adapter-deno";

// `vite build` emits dist/server.js for Node; `DROPLETS_ADAPTER=cloudflare vite build`
// emits dist/worker.js for Cloudflare Workers (see wrangler.jsonc), and
// `bun` or `deno` a dist/server.js for those runtimes.
const adapters = { node, cloudflare, bun, deno };
const adapter = (adapters[process.env["DROPLETS_ADAPTER"] as keyof typeof adapters] ?? node)();

export default defineConfig({
  // The devtools serve `/` in `vite dev` only; builds and previews never see them.
  plugins: [
    droplets({
      adapter,
      renderers: [handlebars()],
      // src/app.css is the shared stylesheet; Tailwind compiles it. Pass
      // `twPreflight: command === "serve"` (with `defineConfig(({ command }) => …)`)
      // when the host pages bring Tailwind's preflight themselves.
      css: { tailwind: true },
    }),
    dropletsDevtools(),
  ],
});

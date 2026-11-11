import { defineConfig } from "tsdown";
import { base, bareImport, graphCheck } from "@dropletsjs/config/tsdown";

export default defineConfig({
  ...base,
  entry: ["./src/index.ts", "./src/server.ts", "./src/client.ts", "./src/client-dev.ts", "./src/children.ts"],
  deps: { neverBundle: [bareImport, /\.svelte$/] },
  // Compiled by the consumer's vite-plugin-svelte.
  copy: [
    "./src/children.svelte",
    "./src/children.svelte.d.ts",
    "./src/boundary.svelte",
    "./src/boundary.svelte.d.ts",
    "./src/form.svelte.js",
    "./src/form.svelte.d.ts",
  ],
  plugins: [
    graphCheck({
      client: ["client", "client-dev", "children"],
      server: ["index", "server"],
    }),
  ],
});

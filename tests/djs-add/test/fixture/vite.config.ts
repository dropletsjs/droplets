import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { node } from "@dropletsjs/adapter-node";
import { svelte } from "@dropletsjs/renderer-svelte";

// A Svelte project: djs add brings in the other frameworks.
export default defineConfig({
  plugins: [droplets({ adapter: node(), renderers: [svelte()] })],
});

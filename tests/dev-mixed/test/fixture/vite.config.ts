import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { preact } from "@dropletsjs/renderer-preact";
import { react } from "@dropletsjs/renderer-react";
import { solid } from "@dropletsjs/renderer-solid";
import { vue } from "@dropletsjs/renderer-vue";

// React, Preact and Solid share `.tsx` (each droplet says which with its
// `@jsxImportSource`); Vue's script blocks are TypeScript.
export default defineConfig({
  plugins: [droplets({ renderers: [react(), preact(), vue(), solid()] })],
});

import { defineConfig } from "tsdown";
import { packageConfig, type PackageOptions } from "../../tsdown.config.base.ts";

export const options: PackageOptions = {
  dir: import.meta.dirname,
  // `server` and `client` are resolved by path from `index`; the shipped
  // `.svelte` components import `./children.js`.
  entry: ["index", "server", "client", "children"],
  client: ["client", "children"],
  server: ["index", "server"],
  // Compiled by the consumer's vite-plugin-svelte; `./form` is `form.svelte.js`.
  asIs: [
    "children.svelte",
    "children.svelte.d.ts",
    "boundary.svelte",
    "boundary.svelte.d.ts",
    "form.svelte.js",
    "form.svelte.d.ts",
  ],
};

export default defineConfig(packageConfig(options));

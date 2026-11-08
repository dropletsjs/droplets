// For `vite dev` on this fixture (the conformance kit builds it with its own
// config): `pnpm exec vite --root test/fixtures/app --port 5183`.
import { defineConfig } from "vite";
import { droplets } from "@dropletsjs/droplets/vite";
import { handlebars } from "../../../src/index.ts";

export default defineConfig({
  plugins: [droplets({ renderers: [handlebars()] })],
});

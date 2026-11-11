import { defineConfig } from "tsdown";
import { base, bareImport, graphCheck } from "@dropletsjs/config/tsdown";

export default defineConfig({
  ...base,
  entry: [
    "./src/index.ts",
    "./src/server.ts",
    "./src/client.ts",
    "./src/client-setup.ts",
    "./src/element.ts",
    "./src/form.ts",
  ],
  deps: { neverBundle: [bareImport] },
  plugins: [
    graphCheck({
      client: ["client", "client-setup", "element", "form"],
      server: ["index", "server", "plugin", "render"],
    }),
  ],
});

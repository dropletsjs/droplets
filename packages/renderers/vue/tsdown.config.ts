import { defineConfig } from "tsdown";
import { base, bareImport, graphCheck } from "@dropletsjs/config/tsdown";

export default defineConfig({
  ...base,
  entry: ["./src/index.ts", "./src/server.ts", "./src/client.ts", "./src/children.ts", "./src/form.ts"],
  deps: { neverBundle: [bareImport] },
  plugins: [
    graphCheck({
      client: ["client", "children", "form"],
      server: ["index", "server"],
    }),
  ],
});

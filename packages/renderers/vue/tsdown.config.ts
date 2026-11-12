import { defineConfig } from "tsdown";
import { base, graphCheck } from "@dropletsjs/shared/tsdown";

export default defineConfig({
  ...base,
  entry: ["./src/index.ts", "./src/server.ts", "./src/client.ts", "./src/client-dev.ts", "./src/children.ts", "./src/form.ts"],
  plugins: [
    graphCheck({
      client: ["client", "client-dev", "children", "form"],
      server: ["index", "server", "flags"],
    }),
  ],
});

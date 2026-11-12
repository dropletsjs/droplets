import { defineConfig } from "tsdown";
import { base, graphCheck } from "@dropletsjs/shared/tsdown";

export default defineConfig({
  ...base,
  entry: ["./src/index.ts", "./src/server.ts", "./src/client.ts", "./src/client-dev.ts", "./src/runtime.ts"],
  plugins: [
    graphCheck({
      client: ["client", "client-dev", "runtime"],
      server: ["index", "server", "plugin", "styles", "flags"],
    }),
  ],
});

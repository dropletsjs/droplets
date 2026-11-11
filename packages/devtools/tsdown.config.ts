import { defineConfig } from "tsdown";
import { base, cssInline, graphCheck } from "@dropletsjs/shared/tsdown";

export default defineConfig({
  ...base,
  entry: ["./src/index.ts", "./src/client/devtools-page.ts", "./src/tool/panel.ts"],
  plugins: [
    cssInline(),
    graphCheck({
      client: ["client/devtools-page", "tool/panel"],
      server: ["index", "page"],
    }),
  ],
});

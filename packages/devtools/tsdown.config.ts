import { defineConfig } from "tsdown";
import { base, bareImport, cssInline, graphCheck } from "@dropletsjs/config/tsdown";

export default defineConfig({
  ...base,
  entry: ["./src/index.ts", "./src/client/devtools-page.ts", "./src/tool/panel.ts"],
  deps: { neverBundle: [bareImport] },
  plugins: [
    cssInline(),
    graphCheck({
      client: ["client/devtools-page", "tool/panel"],
      server: ["index", "page"],
    }),
  ],
});

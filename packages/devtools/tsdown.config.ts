import { defineConfig } from "tsdown";
import { base, bareImport, cssInline, graphCheck } from "@dropletsjs/config/tsdown";

export default defineConfig({
  ...base,
  entry: ["./src/index.ts", "./src/client/devtools.ts", "./src/tool/tool.ts"],
  deps: { neverBundle: [bareImport] },
  plugins: [
    cssInline(),
    graphCheck({
      client: ["client/devtools", "tool/tool"],
      server: ["index", "page"],
    }),
  ],
});

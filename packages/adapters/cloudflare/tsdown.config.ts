import { defineConfig } from "tsdown";
import { base, bareImport, graphCheck } from "@dropletsjs/config/tsdown";

export default defineConfig({
  ...base,
  entry: ["./src/index.ts", "./src/worker.ts"],
  deps: { neverBundle: [bareImport] },
  plugins: [graphCheck()],
});

import { defineConfig } from "tsdown";
import { base, graphCheck } from "@dropletsjs/shared/tsdown";

export default defineConfig({
  ...base,
  entry: ["./src/index.ts", "./src/worker.ts"],
  plugins: [graphCheck()],
});

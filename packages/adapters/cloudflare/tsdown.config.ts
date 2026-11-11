import { defineConfig } from "tsdown";
import { packageConfig, type PackageOptions } from "../../tsdown.config.base.ts";

export const options: PackageOptions = {
  dir: import.meta.dirname,
  // `worker` is resolved by path from `index`: the bundled `dist/worker.js`.
  entry: ["index", "worker"],
};

export default defineConfig(packageConfig(options));

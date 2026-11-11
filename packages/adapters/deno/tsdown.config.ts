import { defineConfig } from "tsdown";
import { packageConfig, type PackageOptions } from "../../tsdown.config.base.ts";

export const options: PackageOptions = {
  dir: import.meta.dirname,
  // `entry` is resolved by path from `index`: the bundled `dist/server.js`.
  entry: ["index", "entry"],
};

export default defineConfig(packageConfig(options));

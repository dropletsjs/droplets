import { defineConfig } from "tsdown";
import { packageConfig, type PackageOptions } from "../tsdown.config.base.ts";

export const options: PackageOptions = {
  dir: import.meta.dirname,
  // `index` is the Vite plugin; it serves the other two by path.
  entry: ["index", "client/devtools", "tool/tool"],
  client: ["client/devtools", "tool/tool"],
  server: ["index", "page"],
};

export default defineConfig(packageConfig(options));

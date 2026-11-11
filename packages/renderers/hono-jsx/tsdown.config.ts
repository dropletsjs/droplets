import { defineConfig } from "tsdown";
import { packageConfig, type PackageOptions } from "../../tsdown.config.base.ts";

export const options: PackageOptions = {
  dir: import.meta.dirname,
  // `server` and `client` are resolved by path from `index`.
  entry: ["index", "server", "client", "form"],
  client: ["client", "form"],
  server: ["index", "server", "plugin"],
};

export default defineConfig(packageConfig(options));

import { defineConfig } from "tsdown";
import { packageConfig, type PackageOptions } from "../../tsdown.config.base.ts";

export const options: PackageOptions = {
  dir: import.meta.dirname,
  // `server`, `client` and `runtime` are resolved by path from `index`.
  entry: ["index", "server", "client", "runtime"],
  client: ["client", "runtime"],
  server: ["index", "server", "plugin", "styles"],
};

export default defineConfig(packageConfig(options));

import { defineConfig } from "tsdown";
import { packageConfig, type PackageOptions } from "../../tsdown.config.base.ts";

export const options: PackageOptions = {
  dir: import.meta.dirname,
  // `server`, `client` and `client-setup` are resolved by path from `index`.
  entry: ["index", "server", "client", "client-setup", "form"],
  client: ["client", "client-setup", "form"],
  server: ["index", "server"],
};

export default defineConfig(packageConfig(options));

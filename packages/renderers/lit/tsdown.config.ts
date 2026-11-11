import { defineConfig } from "tsdown";
import { packageConfig, type PackageOptions } from "../../tsdown.config.base.ts";

export const options: PackageOptions = {
  dir: import.meta.dirname,
  // `server`, `client` and `client-setup` are resolved by path from `index`.
  entry: ["index", "server", "client", "client-setup", "element", "form"],
  client: ["client", "client-setup", "element", "form"],
  server: ["index", "server", "plugin", "render"],
};

export default defineConfig(packageConfig(options));

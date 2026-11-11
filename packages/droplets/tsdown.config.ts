import { defineConfig } from "tsdown";
import { packageConfig, type PackageOptions } from "../tsdown.config.base.ts";

export const options: PackageOptions = {
  dir: import.meta.dirname,
  entry: [
    // package.json `exports` and the `djs` bin.
    "index",
    "vite",
    "env",
    "postcss",
    "testing/index",
    "runtime/server",
    "runtime/enhance",
    "cli",
    // Resolved by path (src/core/paths.ts): the consumer's Vite compiles them.
    "runtime/entry-client",
    "runtime/entry-server",
    "runtime/props",
    "runtime/load",
    "runtime/env-store",
    "runtime/request-store",
    "runtime/form",
    "runtime/client-init",
    // Resolved by path from src/script/index.ts and src/testing.
    "script/server",
    "script/client",
    "testing/conformance-entry",
    "testing/fake-renderer/server",
    "testing/fake-renderer/client",
  ],
  client: [
    "runtime/entry-client",
    "runtime/props",
    "runtime/load",
    "runtime/form",
    "runtime/enhance",
    "runtime/client-init",
    "script/client",
    "testing/fake-renderer/client",
  ],
  // Server code by role (`*.server.*` and `server/` are by name).
  server: [
    "runtime/app",
    "runtime/entry-server",
    "runtime/server",
    "runtime/env-store",
    "runtime/request-store",
    "runtime/security",
    "runtime/cookies",
    "runtime/element",
    "index",
    "vite",
    "cli",
    "testing/index",
    "testing/conformance",
    // The Vite plugin, the config, `djs add`, the CSS scoping: Node only.
    "vite/",
    "core/",
    "add/",
    "css/",
  ],
};

export default defineConfig(packageConfig(options));

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const stub = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "virtual:droplets": stub("./test/stubs/virtual-droplets.ts"),
      "virtual:droplets-dev": stub("./test/stubs/virtual-droplets-dev.ts"),
      "virtual:droplets-config": stub("./test/stubs/virtual-config.ts"),
      "$droplets/env": stub("./src/types/env.ts"),
      "$droplets/server": stub("./src/runtime/server.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    environment: "node",
    environmentOptions: {
      // <link rel="stylesheet"> appends must not throw in the entry-client tests.
      happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } },
    },
    testTimeout: 20_000,
  },
});

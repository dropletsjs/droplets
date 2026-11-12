import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // A `djs add` per framework and case, plus the script droplets, then a type check, a build and a server.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

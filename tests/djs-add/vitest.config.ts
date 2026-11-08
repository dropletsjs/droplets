import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Thirty `djs add` runs, a type check, a build and a server.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

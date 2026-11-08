import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Nine projects, each synced, type-checked, built and served.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});

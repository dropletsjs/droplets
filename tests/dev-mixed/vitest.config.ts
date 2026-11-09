import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // A dev server, its first dependency optimization and a browser.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});

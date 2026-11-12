import { defineConfig } from "vitest/config";

// The static checks over examples/ (test/); the compose flows are Playwright, in e2e/.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});

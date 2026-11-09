import { defineConfig } from "vitest/config";

// Not vite.config.ts: the tests drive plain modules and the built server
// (built by test/server.test.ts against a stand-in WordPress), without the
// droplets plugin.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});

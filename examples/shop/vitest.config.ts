import { defineConfig } from "vitest/config";

// Not vite.config.ts: the tests drive the built server (dist/server.js) and
// plain modules, without the droplets plugin.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // The server tests share one seeded database file.
    fileParallelism: false,
  },
});

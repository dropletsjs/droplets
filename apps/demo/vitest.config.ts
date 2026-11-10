import { defineConfig } from "vitest/config";

// Not vite.config.ts: the tests drive the built servers (dist/server.js, and
// dist/worker.js under wrangler) and plain modules, without the droplets plugin.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // Both suites build into dist/: one after the other.
    fileParallelism: false,
  },
});

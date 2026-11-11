import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // `?inline` styles as text, as the build has them; Vitest blanks CSS otherwise.
    css: { include: [/\.css\?inline$/] },
    testTimeout: 60_000,
  },
});

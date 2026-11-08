import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The conformance kit mounts the built bundles in happy-dom.
    environment: "happy-dom",
    environmentOptions: {
      // <link rel="stylesheet"> appends by the element must not throw.
      happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } },
    },
    testTimeout: 60_000,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Node, not happy-dom: Lit's server build and DOM shim must find no
    // browser globals, as on a server. What happens in a browser (declarative
    // shadow DOM, hydration, innerHTML insertion) is checked in Chromium by
    // tests/examples (the `lit` project).
    environment: "node",
    testTimeout: 120_000,
  },
});

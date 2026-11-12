import { happyDom } from "@dropletsjs/shared/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Node, not happy-dom: Lit's server build and DOM shim must find no
    // browser globals, as on a server. Only test/conformance.test.ts switches
    // to happy-dom (its pragma), for the browser side of the kit; the server
    // side renders in the kit's worker thread, where there is no DOM either.
    environment: "node",
    environmentOptions: happyDom.environmentOptions,
    testTimeout: 120_000,
  },
});

import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
// The browser builds of Solid, for the client module's unit tests: under
// Node, `solid-js/web` resolves to the server build, where `hydrate` and
// `render` are not supported.
const solidBrowser = require.resolve("solid-js/dist/solid.js");
const solidWebBrowser = require.resolve("solid-js/web/dist/web.js");

// Both DOM projects mount things in happy-dom; the conformance kit also
// appends <link rel="stylesheet">, which must not throw.
const happyDom = {
  environment: "happy-dom" as const,
  environmentOptions: { happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } } },
};

export default defineConfig({
  test: {
    testTimeout: 60_000,
    projects: [
      {
        // The factory, the Vite plugin per environment and the server module.
        test: { name: "node", include: ["test/renderer.test.ts", "test/server.test.ts"], environment: "node" },
      },
      {
        test: {
          name: "client",
          include: ["test/client.test.ts"],
          ...happyDom,
          server: { deps: { inline: [/solid-js/] } },
        },
        resolve: {
          alias: [
            { find: /^solid-js\/web$/, replacement: solidWebBrowser },
            { find: /^solid-js$/, replacement: solidBrowser },
          ],
        },
      },
      {
        // The built bundles are self-contained: Solid is inside them.
        test: { name: "conformance", include: ["test/conformance.test.ts"], ...happyDom },
      },
    ],
  },
});

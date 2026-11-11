import type { ViteUserConfig } from "vitest/config";

/** happy-dom, where a `<link rel="stylesheet">` the element appends must not throw. */
export const happyDom = {
  environment: "happy-dom",
  environmentOptions: { happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } } },
} satisfies NonNullable<ViteUserConfig["test"]>;

/** A renderer's suite. The conformance kit mounts the built bundles in happy-dom. */
export const rendererTests: ViteUserConfig = {
  test: { include: ["test/**/*.test.ts"], ...happyDom, testTimeout: 60_000 },
};

/** An adapter's suite: it builds the fixture app and serves it. */
export const adapterTests: ViteUserConfig = {
  test: { include: ["test/**/*.test.ts"], environment: "node", testTimeout: 60_000 },
};

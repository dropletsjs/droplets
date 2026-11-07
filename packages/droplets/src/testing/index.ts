/**
 * `@dropletsjs/droplets/testing`: what a renderer package needs to test
 * itself. `rendererConformance()` is the suite (see `conformance.ts` for the
 * fixture it expects); `fakeRenderer()` is a complete reference renderer.
 * Imports vitest, so it is for test files only.
 */
export { rendererConformance, type ConformanceOptions } from "./conformance.ts";
export { fakeRenderer } from "./fake-renderer/index.ts";

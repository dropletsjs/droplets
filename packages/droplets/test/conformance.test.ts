// @vitest-environment happy-dom
// The conformance kit, proven on the reference renderer and the core fixture.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeRenderer, rendererConformance } from "../src/testing/index.ts";

rendererConformance({
  renderer: fakeRenderer(),
  // Under happy-dom `URL` is the browser one, so no `new URL(..., import.meta.url)`.
  root: resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/app"),
});

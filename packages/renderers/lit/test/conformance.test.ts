// @vitest-environment happy-dom
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rendererConformance } from "@dropletsjs/droplets/testing";
import { lit } from "../src/index.ts";

// The kit builds the fixture with the renderer and checks SSR, inline data,
// hydration, client-only mounting, the error page, children, prerendering,
// form actions and HMR. The server renders in its own worker thread (Lit's
// DOM shim, no happy-dom); the browser side runs under happy-dom, hence the
// pragma above, the package's other tests staying under Node.
rendererConformance({
  renderer: lit(),
  // Under happy-dom `URL` is the browser one, so no `new URL(..., import.meta.url)`.
  root: resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/conformance"),
  // A Lit component's styles live in its shadow root (`static styles`): the client build extracts none.
  css: false,
});

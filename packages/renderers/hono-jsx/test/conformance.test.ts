import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rendererConformance } from "@dropletsjs/droplets/testing";
import { honoJsx } from "../src/index.ts";

// The kit builds the fixture with the renderer and checks SSR, inline data,
// hydration, client-only mounting, the error page, children, prerendering
// and HMR. The vitest config runs it under happy-dom.
rendererConformance({
  renderer: honoJsx(),
  // hono/jsx/dom renders again where the server markup was.
  adopts: false,
  // Under happy-dom `URL` is the browser one, so no `new URL(..., import.meta.url)`.
  root: resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/app"),
});

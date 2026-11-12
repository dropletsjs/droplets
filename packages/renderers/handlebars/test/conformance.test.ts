import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rendererConformance } from "@dropletsjs/droplets/testing";
import { handlebars } from "../src/index.ts";

// The kit builds the fixture with the renderer and checks SSR, inline data,
// hydration, client-only mounting, the error page, children, prerendering,
// form actions and HMR. Handlebars has no client behaviour (the count
// button never counts), so that check is off; its guestbook opts in to
// enhancement with `data-droplet-enhance`. Styles come from `<style>` blocks.
rendererConformance({
  renderer: handlebars(),
  // Under happy-dom `URL` is the browser one, so no `new URL(..., import.meta.url)`.
  root: resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/app"),
  interactive: false,
  // `data-droplet-enhance` on a `hydrate = false` guestbook: `/index.js` binds it.
  enhance: "attribute",
});

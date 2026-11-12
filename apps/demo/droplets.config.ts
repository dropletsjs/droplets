import { config } from "@dropletsjs/droplets";
import { docsOrigins } from "./src/lib/origins.ts";

export default config({
  /** Every demo droplet renders inside `<djs-demo>`. */
  element: "djs-demo",

  /**
   * The docs pages embed these droplets from another origin: they import
   * `/index.js` and the bundles, fetch `_data` and post the poll. Only the
   * docs' origins get CORS answers (src/lib/origins.ts: the docs' dev port
   * too, under `pnpm docs:dev`); a preflight is kept for a day.
   */
  cors: { origin: docsOrigins(), maxAge: 86_400 },

  /**
   * The pages whose forms may post here, and where Post/Redirect/Get may
   * send the browser back to.
   */
  trustedOrigins: docsOrigins(),

  /**
   * Both fixed: `vite build` writes the demo's public URL and the docs'
   * origin into the server bundle, so no location header is read or
   * trusted and no answer is rewritten on its way out. `vite dev` ignores
   * both and computes them per request (`pnpm docs:dev`); `vite preview`
   * and `wrangler dev` write URLs on demo.dropletsjs.dev.
   */
  location: "https://demo.dropletsjs.dev",
  host: "https://dropletsjs.dev",

  /** The poll is two short fields, a render body is the page and a few props: nothing bigger is ever read. */
  limits: { json: 16 * 1024, form: 4 * 1024, multipart: 8 * 1024, props: 1024 },

  dev: { server: { port: 5180 } },
  server: { port: 8790 },
});

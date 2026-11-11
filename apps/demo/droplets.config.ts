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
   * send the browser back to. The location is computed per request: the
   * docs build sends its public URL as `x-droplet-location`, trusted with
   * `DROPLETS_TRUSTED_ORIGINS` (apps/docs/scripts/with-demo.mjs).
   */
  trustedOrigins: docsOrigins(),

  /** The poll is two short fields: nothing bigger is ever read. */
  limits: { json: 16 * 1024, form: 4 * 1024, multipart: 8 * 1024, props: 1024 },

  dev: { server: { port: 5180 } },
  server: { port: 8790 },
});

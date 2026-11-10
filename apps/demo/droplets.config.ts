import { config } from "@dropletsjs/droplets";
import { DOCS_ORIGINS } from "./src/lib/origins.ts";

export default config({
  /** Every demo droplet renders inside `<djs-demo>`. */
  element: "djs-demo",

  /**
   * The docs pages embed these droplets from another origin: they import
   * `/index.js` and the bundles, fetch `_data` and post the poll. Only the
   * docs' origins get CORS answers; a preflight is kept for a day.
   */
  cors: { origin: [...DOCS_ORIGINS], maxAge: 86_400 },

  /**
   * The pages whose forms may post here, and where Post/Redirect/Get may
   * send the browser back to. The origin the docs build reaches the demo
   * through (`x-host`) is added at runtime with `DROPLETS_TRUSTED_ORIGINS`.
   */
  trustedOrigins: [...DOCS_ORIGINS],

  /** The poll is two short fields: nothing bigger is ever read. */
  limits: { json: 16 * 1024, form: 4 * 1024, multipart: 8 * 1024, props: 1024 },

  dev: { server: { port: 5180 } },
  server: { port: 8790 },
});

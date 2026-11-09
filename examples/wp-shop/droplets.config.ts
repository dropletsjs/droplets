import { config } from "@dropletsjs/droplets";

export default config({
  dropletsFolder: "src/droplets",

  /** The same element as examples/shop: the shop's UI, backed by WordPress. */
  element: "djs-shop",

  /**
   * No CORS: WordPress is the only host, and its plugin proxies
   * `/index.js`, `/droplets`, `/assets` and `/api` under its own origin.
   * wp-shop is never reachable around it.
   */
  cors: false,

  /**
   * WordPress's public origin comes from `DROPLETS_TRUSTED_ORIGINS` at
   * runtime: its `x-host`, and the pages whose forms post here.
   */
  trustedOrigins: [],

  dev: { server: { port: 5175 } },
  server: { port: 8310 },
});

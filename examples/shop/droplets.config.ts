import { config } from "@dropletsjs/droplets";

export default config({
  dropletsFolder: "src/droplets",

  /** Every shop droplet renders inside `<djs-shop>`. */
  element: "djs-shop",

  /**
   * Hosts are told to proxy `/index.js`, `/droplets`, `/assets` and `/api`
   * under their own origin (cookies first-party, no preflights). CORS stays
   * on for a host that embeds cross-origin anyway; it gets no cookies.
   */
  cors: true,

  /**
   * The host origins whose pages post forms here come from
   * `DROPLETS_TRUSTED_ORIGINS` at runtime (comma-separated), so a new host
   * needs no rebuild. A proxied host's `x-droplet-location` is its own
   * origin, so the same list trusts it.
   */
  trustedOrigins: [],

  /** An admin product image is at most 2 MB; the form around it is small. */
  limits: { multipart: 3 * 1024 * 1024 },

  dev: { server: { port: 5174 } },
  server: { port: 8300 },
});

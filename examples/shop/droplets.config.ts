import { config } from "@dropletsjs/droplets";

function trustedHostOrigins(): string[] {
  return (process.env.DROPLETS_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "" && entry !== "*");
}

export default config({
  dropletsFolder: "src/droplets",

  /** Every shop droplet renders inside `<djs-shop>`. */
  element: "djs-shop",

  /**
   * Hosts are told to proxy `/index.js`, `/droplets`, `/assets` and `/api`
   * under their own origin (cookies first-party, no preflights). A page
   * that calls the shop cross-origin instead (examples/hosts/static) gets
   * its cookies when its origin is in `DROPLETS_TRUSTED_ORIGINS`, read per
   * request: that origin echoed with credentials, never `*`. Any other
   * origin gets no CORS answer.
   */
  cors: {
    origin: (origin) => (trustedHostOrigins().includes(origin) ? origin : null),
    credentials: true,
  },

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

import { config } from "@dropletsjs/droplets";

export default config({
  /**
   * The custom element that hosts every droplet from this server. Naming it
   * after the project keeps it from colliding with droplets served by other
   * servers on the same page. Default: "djs-droplet".
   */
  element: "djs-preact",

  /**
   * Host pages on other origins embed these droplets (examples/hosts/*,
   * tests/examples), so the browser must be allowed to import
   * `/droplets/<id>/client.js` cross-origin.
   */
  cors: true,

  dev: { server: { port: 5173 } },
  server: { port: 8000 },
});

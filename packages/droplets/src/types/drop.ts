/** Type stub for `$droplets/drop`; the plugin generates the real module. */
export type Droplet = {
  /**
   * The droplets server as the browser reaches it: where the page loads
   * the droplets from (the URL it loaded `/index.js` from), or on the
   * server the request's public location (a trusted location header, an `http(s)` URL). May
   * carry a path when a proxy serves the droplets under one. `""` on the
   * server outside a request.
   */
  readonly origin: string;
  /**
   * `path` on the droplets server: `droplet.url("/api/counter")`. Use it
   * for every request a droplet makes to its own server; a relative
   * `fetch("/api/…")` would go to the host page's origin.
   */
  url(path: string): string;
};

export const droplet = {} as Droplet;
export default droplet;

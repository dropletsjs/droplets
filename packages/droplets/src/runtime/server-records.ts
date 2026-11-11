/**
 * What a page knows about each droplets server it embeds: where its
 * elements load from, and its public runtime variables. One record per
 * server and build on `globalThis`, keyed `<element>:<build>` (see
 * `serverKey`), so two servers on one page never mix; `$droplets/drop` and
 * `$droplets/env/public` read it in the browser.
 */
export type ServerRecord = {
  /**
   * The server's location: where the page loaded its `/index.js` from, with
   * the path a proxy serves it under and no trailing slash
   * (`https://shop.example/mfe`). `/index.js` writes it, from its own URL:
   * nothing in the page's markup can move it.
   */
  origin?: string;
  /** Public variables read at runtime, as the server sent them with `/index.js`. */
  env?: Record<string, string>;
};

const SERVERS = Symbol.for("droplets.servers");

/**
 * A server's key on the page: its element name, which servers sharing a
 * page must already keep distinct, and the build, which tells two builds
 * of one server apart. `djs:a151d9`.
 */
export function serverKey(element: string, build: string): string {
  return `${element}:${build}`;
}

/** The record under `key` (`serverKey`), created on first use. */
export function serverRecord(key: string): ServerRecord {
  const global = globalThis as { [SERVERS]?: Record<string, ServerRecord> };
  global[SERVERS] ??= {};
  return (global[SERVERS][key] ??= {});
}

/** The server whose location `serverLocation` reads: its key (`serverKey`). */
export type ServerLocationInput = { key: string };

/**
 * Where the browser loads a server's files from: the location `/index.js`
 * recorded, else the root of the build this code was bundled into, found
 * from the bundle's own URL, path prefix included. The build replaces
 * `__DROPLETS_BUILD_ROOT__` in each output file with the way from that file
 * back to the root (`../../`), and `vite dev` with `/`.
 */
export function serverLocation({ key }: ServerLocationInput): string {
  return serverRecord(key).origin ?? buildRoot({ moduleUrl: import.meta.url });
}

type BuildRootInput = { moduleUrl: string };

// Not `new URL("…", import.meta.url)`: Vite would take the marker for a file to bundle.
function buildRoot({ moduleUrl }: BuildRootInput): string {
  return new URL("__DROPLETS_BUILD_ROOT__", moduleUrl).href.replace(/\/$/, "");
}

/**
 * The JavaScript `/index.js` starts with: the server's location under
 * `key`, from the URL the page loaded it from. `/index.js` is a module
 * script, so `import.meta.url` is that URL. `@vite-ignore`: under
 * `vite dev`, Vite would otherwise take `"."` for an asset to resolve.
 */
export function locationScript(key: string): string {
  const record = `(globalThis[Symbol.for("droplets.servers")] ??= {})[${JSON.stringify(key)}] ??= {}`;
  return `\n(${record}).origin = new URL(/* @vite-ignore */ ".", import.meta.url).href.replace(/\\/$/, "");\n`;
}

/** The JavaScript `/index.js` starts with: the public runtime variables under `key`. */
export function publicEnvScript(key: string, values: Record<string, string | undefined>): string {
  const record = `(globalThis[Symbol.for("droplets.servers")] ??= {})[${JSON.stringify(key)}] ??= {}`;
  return `\n(${record}).env = ${JSON.stringify(values).replace(/</g, "\\u003c")};\n`;
}

/**
 * `event.host`, where a droplet renders (the host page), and the droplet's
 * location, where it is served from. Runtime-neutral: the server, the SSR
 * bundle and the build share it.
 *
 * On the server `host` comes from the request the classic way, and `handle`
 * in `hooks.server.ts` may replace it. While prerendering without a known
 * host it is a stand-in whose `origin`, `pathname` and `href` are tokens,
 * swapped for the real host on every request that serves the render.
 *
 * Both come from what a client sends, so only web URLs pass: `http:` or
 * `https:`, without credentials or hash. A `javascript:` or `data:` value
 * never reaches a link, a script URL or a redirect.
 */
import { HostUrlPropsErrorInPrerender } from "./server.ts";
import { webUrl, withinTrusted } from "./web-url.ts";

export { webUrl, withinTrusted };

/** A host from a string or a URL: a web URL (see `webUrl`), or `null`. */
export function parseHost(value: unknown): URL | null {
  return webUrl(value);
}

/**
 * Where the droplets server is reached, from `x-host`: its origin and the
 * path prefix a proxy serves it under (`https://shop.example/mfe`), without
 * a trailing slash, query or hash. `null` unless it is a web URL.
 */
export function parseLocation(value: unknown): string | null {
  const url = webUrl(value);
  return url ? `${url.origin}${url.pathname.replace(/\/+$/, "")}` : null;
}

/**
 * What stands for `host.origin` and `host.pathname` in a build-time render,
 * and for the droplets server's location (`droplet.origin`, `actionUrl()`):
 * where a render is served from is only known per request.
 */
export type HostTokens = { host: string; path: string; location: string };

/**
 * The tokens of one build. The nonce is random per build and stays on the
 * server, with the renders: content a user wrote cannot hold a token that
 * gets replaced.
 */
export function hostTokens(nonce = ""): HostTokens {
  const suffix = nonce ? `_${nonce}` : "";
  return {
    host: `__$DROPLET_HOST${suffix}$__`,
    path: `__$DROPLET_PATH${suffix}$__`,
    location: `__$DROPLET_LOCATION${suffix}$__`,
  };
}

/**
 * What the tokens of a build-time render become for one request: the host
 * it renders on, and the location it is served from (a trusted `x-host`,
 * else the request's origin; never an untrusted header).
 */
export type TokenValues = { host: URL; location: string };

/** A fresh nonce for `hostTokens`: 16 hex characters. */
export function tokenNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** `host` and `proto` of the first element of an RFC 7239 `Forwarded` header. */
function parseForwarded(header: string): { host?: string; proto?: string } {
  const first = header.split(",")[0] ?? "";
  const found: { host?: string; proto?: string } = {};
  for (const pair of first.split(";")) {
    const at = pair.indexOf("=");
    if (at < 0) continue;
    const name = pair.slice(0, at).trim().toLowerCase();
    const value = pair.slice(at + 1).trim().replace(/^"(.*)"$/, "$1");
    if (name === "host" || name === "proto") found[name] = value;
  }
  return found;
}

/** The first value of a header a chain of proxies may have appended to. */
function firstValue(value: string | null): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return first ? first : undefined;
}

/**
 * The host page, the classic way: `Forwarded` (RFC 7239), then
 * `X-Forwarded-Proto` + `X-Forwarded-Host`, then `Origin`, then the
 * request's own origin. Headers carry an origin only: the path is `/`. A
 * value that is not a web URL (`X-Forwarded-Proto: javascript`) is skipped
 * for the next source.
 */
export function hostFromHeaders(headers: Headers, requestUrl: URL): URL {
  const protocol = requestUrl.protocol.replace(/:$/, "");
  const forwarded = headers.get("forwarded");
  if (forwarded) {
    const { host, proto } = parseForwarded(forwarded);
    const url = host ? webUrl(`${proto ?? protocol}://${host}`) : null;
    if (url) return new URL(url.origin);
  }
  const forwardedHost = firstValue(headers.get("x-forwarded-host"));
  if (forwardedHost) {
    const proto = firstValue(headers.get("x-forwarded-proto")) ?? protocol;
    const url = webUrl(`${proto}://${forwardedHost}`);
    if (url) return new URL(url.origin);
  }
  const origin = headers.get("origin");
  if (origin && origin !== "null") {
    const url = webUrl(origin);
    if (url) return new URL(url.origin);
  }
  return new URL(requestUrl.origin);
}

/**
 * The host of a render made at build without one: `origin`, `pathname` and
 * `href` (and `toString()`, `toJSON()`) give tokens. Any other URL field
 * throws `HostUrlPropsErrorInPrerender`, and the access is kept in
 * `violation`, so a `try`/`catch` in the droplet's code cannot hide it: the
 * build checks it after every render.
 */
export type HostProbe = { host: URL; violation: HostUrlPropsErrorInPrerender | undefined };

/** The fields of a URL that have no token: reading one needs the real host. */
const URL_FIELDS = new Set(["hash", "host", "hostname", "password", "port", "protocol", "search", "searchParams", "username"]);

export function prerenderHost(droplet: string, entry: string, tokens: HostTokens = hostTokens()): HostProbe {
  const href = `${tokens.host}${tokens.path}`;
  const allowed: Record<string, unknown> = {
    origin: tokens.host,
    pathname: tokens.path,
    href,
    toString: () => href,
    toJSON: () => href,
    valueOf: () => href,
    constructor: URL,
  };
  const probe: HostProbe = { host: undefined as unknown as URL, violation: undefined };
  probe.host = new Proxy(Object.create(URL.prototype) as URL, {
    get(_target, property) {
      if (typeof property === "symbol") return undefined;
      if (Object.hasOwn(allowed, property)) return allowed[property];
      // Only what a URL has: framework probes (`then`, `__v_skip`, …) are
      // not the droplet reading the host.
      if (!URL_FIELDS.has(property)) return undefined;
      const error = new HostUrlPropsErrorInPrerender(droplet, entry, property);
      probe.violation ??= error;
      throw error;
    },
  });
  return probe;
}

const ESCAPE_HTML: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPE_HTML[char] ?? char);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `text` with each token replaced by its value, written by `write`, plain
 * and `encodeURIComponent`d. One pass: a value is never read for tokens again.
 */
function swap(text: string, { host, location }: TokenValues, tokens: HostTokens, write: (value: string) => string): string {
  if (!text.includes("DROPLET_")) return text;
  const values = new Map<string, string>();
  const pairs = [[tokens.host, host.origin], [tokens.path, host.pathname], [tokens.location, location]] as const;
  for (const [token, value] of pairs) {
    values.set(token, write(value));
    values.set(encodeURIComponent(token), write(encodeURIComponent(value)));
  }
  const pattern = new RegExp([...values.keys()].map(escapeRegExp).join("|"), "g");
  return text.replace(pattern, (token) => values.get(token) ?? token);
}

/**
 * A build-time render's HTML for one request: tokens replaced, escaped for
 * attributes and text. Only those positions: a token inside an inline
 * `<script>` or `<style>` gets HTML escaping too, not JS or CSS escaping
 * (`origin`, `pathname` and a location cannot carry `<`, `>` or `"`;
 * documented).
 */
export function replaceHostTokens(html: string, values: TokenValues, tokens: HostTokens = hostTokens()): string {
  return swap(html, values, tokens, escapeHtml);
}

/** Build-time server data (or error) for one request: tokens replaced inside its strings. */
export function replaceHostTokensInData<T>(data: T, values: TokenValues, tokens: HostTokens = hostTokens()): T {
  if (data === undefined) return data;
  const json = JSON.stringify(data);
  if (json === undefined || !json.includes("DROPLET_")) return data;
  return JSON.parse(swap(json, values, tokens, (value) => JSON.stringify(value).slice(1, -1))) as T;
}
